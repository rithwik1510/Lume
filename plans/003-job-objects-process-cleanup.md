# Plan 003: Kill the whole process tree with Windows Job Objects

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 0cc44a3..HEAD -- src-tauri/src/pty.rs src-tauri/Cargo.toml`
> EXPECTED drift: Plan 001 made the commands `async fn`; Plan 002 replaced the
> `closed` flag with a `PaneBuffer` and rewired the flusher. Both are fine.
> Any other structural mismatch with "Current state" is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/002-pty-flush-and-backpressure.md (same file; land in order)
- **Category**: bug
- **Planned at**: commit `0cc44a3`, 2026-06-12

## Why this matters

`pty_kill` calls `session.killer.lock().kill()` (`src-tauri/src/pty.rs:403`),
which is `TerminateProcess` on **the shell process only**. The processes the
shell spawned — `node`, a running `claude` session, `wsl.exe` trees — survive
as orphans, invisible, burning CPU/RAM. There is also no app-exit cleanup:
`lib.rs` calls `.run(ctx)` with no exit handling, and `Cargo.toml` sets
`panic = "abort"`, so a crash leaves every agent process running.

The standard Windows fix (used by Windows Terminal and VS Code) is a **Job
Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`** per pane: assign the shell
to the job at spawn; every descendant inherits membership; closing the job
handle kills the entire tree. Because the OS closes all handles when the Lume
process dies — cleanly, by crash, or by `panic = "abort"` — this one mechanism
fixes pane-close orphans, app-exit orphans, and crash orphans simultaneously.
Flagged in `docs/QUALITY-REVIEW-2026-06-09.md` §4; verified still present.

## Current state

Files:

- `src-tauri/src/pty.rs` — `PtySession` struct (around line 118; after Plan
  002 it holds `master`, `writer`, `buffer: Arc<PaneBuffer>`, `shell_pid`,
  `killer`), `pty_open` (spawn at ~line 247: `pair.slave.spawn_command(cmd)`,
  then `child.process_id()` at ~line 255), `pty_kill` (~line 396). Already has
  a `#[cfg(target_os = "windows")]` Win32 block: `child_count` (lines 428-459)
  using `winapi` Toolhelp32 — match its unsafe style and comments.
- `src-tauri/Cargo.toml` — line 38:
  `winapi = { version = "0.3", features = ["tlhelp32", "handleapi"] }`

Excerpt — `pty_kill` today (post-Plan-002 shape; `closed` became `buffer.close()`):

```rust
#[tauri::command]
pub async fn pty_kill(pane_id: String, state: State<'_, PtyRegistry>) -> AppResult<()> {
    if let Some((_, session)) = state.sessions.remove(&pane_id) {
        session.buffer.close();
        let _ = session.killer.lock().kill();
    }
    Ok(())
}
```

Repo conventions: no `unwrap()` in production paths; failures degrade
gracefully with `log::warn!` (see the `cwd` guard in `pty_open`, lines
235-246, for the logging style).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Rust tests | `cd src-tauri; cargo test --lib` | all pass, exit 0 |
| Lint | `cd src-tauri; cargo clippy --all-targets -- -D warnings` | exit 0 |
| Format | `cd src-tauri; cargo fmt --all -- --check` | exit 0 |
| Manual run | `npm run tauri dev` | app opens, terminal echoes |

## Scope

**In scope**:
- `src-tauri/src/pty.rs`
- `src-tauri/Cargo.toml` (winapi feature additions ONLY)

**Out of scope** (do NOT touch):
- `src-tauri/src/lib.rs` — no `RunEvent::Exit` handler is needed; kill-on-close
  makes the OS do exit cleanup. If you think you need one, STOP and report.
- The TS side, `is_pty_busy` / `child_count` (still useful for the confirm dialog).
- Non-Windows builds — gate everything `#[cfg(target_os = "windows")]` with a
  no-op fallback, mirroring how `child_count` does it (lines 461-467).

## Git workflow

- Branch: `advisor/003-job-objects-process-cleanup`
- Commit style: `fix(pty): kill the whole process tree via Job Objects (kill-on-close)`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add the winapi features

In `src-tauri/Cargo.toml` line 38, extend features to:

```toml
winapi = { version = "0.3", features = ["tlhelp32", "handleapi", "jobapi2", "winnt", "processthreadsapi"] }
```

**Verify**: `cd src-tauri; cargo build --lib` → compiles (warnings OK at this step).

### Step 2: Add a `PaneJob` RAII wrapper

In `pty.rs`, in a `#[cfg(target_os = "windows")]` block near `child_count`:

```rust
/// Owns one Job Object configured with KILL_ON_JOB_CLOSE. Dropping it (or the
/// whole process dying — cleanly or by crash) makes the OS terminate every
/// process assigned to the job, i.e. the shell and all its descendants.
struct PaneJob(winapi::shared::ntdef::HANDLE);
// SAFETY: a job HANDLE is just a kernel handle; it is valid to use/close from
// any thread. We never alias the handle mutably.
unsafe impl Send for PaneJob {}
unsafe impl Sync for PaneJob {}

impl PaneJob {
    /// Create a job, set kill-on-close, and assign `pid` to it.
    /// Returns None (with a WARN log) on any API failure — callers fall back
    /// to the existing single-process killer.
    fn assign(pid: u32) -> Option<Self> { /* see body below */ }
}

impl Drop for PaneJob {
    fn drop(&mut self) {
        // Kill-on-close fires here: closing the last handle kills the tree.
        unsafe { winapi::um::handleapi::CloseHandle(self.0); }
    }
}
```

Body of `assign` (the exact Win32 sequence):

1. `CreateJobObjectW(null_mut(), null_mut())` → null = fail.
2. `JOBOBJECT_EXTENDED_LIMIT_INFORMATION` zeroed;
   `info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;`
   `SetInformationJobObject(job, JobObjectExtendedLimitInformation, &mut info as *mut _ as *mut _, size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32)` → 0 = fail (CloseHandle the job before returning None).
3. `OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, FALSE, pid)` → null = fail (close job).
4. `AssignProcessToJobObject(job, proc_handle)` → 0 = fail (close BOTH handles, log the `GetLastError`-free reason as "assign failed"; that's enough detail).
5. `CloseHandle(proc_handle)` (the job keeps its own reference); return `Some(PaneJob(job))`.

Imports come from `winapi::um::{jobapi2, processthreadsapi, handleapi, winnt}`.
Every failure path: `log::warn!("job object unavailable for pid {pid}: <which step>")`
and `None` — never panic, never return an error to the caller.

Non-Windows: define `struct PaneJob;` with `fn assign(_pid: u32) -> Option<Self> { None }`
under `#[cfg(not(target_os = "windows"))]`, mirroring `child_count`'s pattern.

**Verify**: `cd src-tauri; cargo clippy --all-targets -- -D warnings` → exit 0.

### Step 3: Wire it into the session lifecycle

1. Add field to `PtySession`: `job: Option<PaneJob>,`.
2. In `pty_open`, right after `let shell_pid = child.process_id();`:
   `let job = shell_pid.and_then(PaneJob::assign);`
   and store it in the `PtySession` literal.
3. `pty_kill` and the idempotent re-open teardown at the top of `pty_open`:
   no new code — removing the session from the DashMap drops `PtySession`,
   which drops `PaneJob`, which kills the tree. KEEP the existing
   `let _ = session.killer.lock().kill();` as belt-and-braces for the
   `job == None` fallback path.

**Verify**: `cd src-tauri; cargo test --lib` → all pass.

### Step 4: Manual verification of the actual kill behavior

Run `npm run tauri dev`:

1. In a pane, run a process that spawns children, e.g. `node` (or
   `powershell -Command "Start-Sleep 600"` nested: run `powershell` then
   inside it `node` or another `powershell`). Note the child PIDs via
   `Get-Process node` (separate real terminal).
2. Close the pane in Lume → within ~2 s the child PIDs are GONE
   (`Get-Process node` errors / no longer lists them).
3. Repeat, then close the whole Lume window → all descendants gone.
4. Repeat, then kill Lume forcefully (`Stop-Process -Name lume -Force` from a
   real terminal) → all descendants gone (this is the crash-path guarantee).

**Verify**: all three teardown paths leave zero orphaned descendants. If you
cannot run a GUI, mark "NOT RUN — needs operator smoke test" in your report
and the README status note.

### Step 5: Format + final sweep

**Verify**: `cargo fmt --all -- --check`, `cargo clippy --all-targets -- -D warnings`,
`cargo test --lib` exit 0.

## Test plan

Job/kill behavior is OS-level and not unit-testable in `cargo test --lib`
without spawning real processes; the manual matrix in Step 4 is the test.
Add ONE compile-level test: `pane_job_assign_invalid_pid_returns_none` —
`PaneJob::assign(0xFFFF_FFFF)` (bogus PID) returns `None` and does not panic.
Gate it `#[cfg(target_os = "windows")]`.

## Done criteria

ALL must hold:

- [ ] `Select-String -Path src-tauri/src/pty.rs -Pattern "KILL_ON_JOB_CLOSE"` → at least one match
- [ ] `Select-String -Path src-tauri/Cargo.toml -Pattern "jobapi2"` → one match
- [ ] `cd src-tauri; cargo test --lib` exits 0 (incl. the new invalid-PID test)
- [ ] `cargo clippy --all-targets -- -D warnings` and `cargo fmt --all -- --check` exit 0
- [ ] Step 4 manual matrix recorded as passed, or explicitly flagged NOT RUN
- [ ] `git status` clean outside the two in-scope files and `plans/README.md`
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- `AssignProcessToJobObject` fails consistently on a normally-spawned shell in
  Step 4 (possible job-nesting conflict with ConPTY on this Windows build) —
  the fallback keeps the app working, but the plan's premise needs review.
- Closing a pane starts killing processes from OTHER panes (job handle mixup).
- You need to modify `portable-pty` interaction (e.g. spawn flags) to make
  assignment work — that's a design change, not an improvisation.
- `winapi 0.3` lacks any of the needed functions/types (would force a
  migration to the `windows` crate — out of scope; report instead).

## Maintenance notes

- If Lume ever adds "detach pane" (keep process after close), that feature
  must take the `PaneJob` out of the session BEFORE drop, or the detached
  process dies. Flag this in any such future review.
- Reviewer focus: every `unsafe` block has a SAFETY comment; all four
  `assign` failure paths close the handles they opened (no handle leaks).
- Deferred deliberately: `RunEvent::Exit` graceful teardown (redundant with
  kill-on-close); per-job memory/CPU limits (possible future "runaway agent"
  guardrail — the job object is now in place to hang them on).
