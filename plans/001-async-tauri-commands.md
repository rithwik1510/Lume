# Plan 001: Move blocking Tauri commands off the main thread

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 0cc44a3..HEAD -- src-tauri/src/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `0cc44a3`, 2026-06-12

## Why this matters

In Tauri v2, a `#[tauri::command]` declared as a plain (non-`async`) `fn` runs
**on the main thread**. Every command in this app is currently sync
(`src-tauri/src/lib.rs:60-78`), so the UI event loop is blocked while:

- `git_current_branch` waits up to **2 seconds** on `recv_timeout` (`src-tauri/src/git.rs:42`) — called every few seconds per active session by the branch poller;
- `detect_shells` runs `wsl.exe -l -q` synchronously (`src-tauri/src/shell_detect.rs:31-35`) — **seconds** on a cold WSL install, at app boot;
- `pty_open` does `openpty` + process spawn (`src-tauri/src/pty.rs:219-250`);
- `read_text_file` / `write_text_file` / `list_dir` do disk I/O (`src-tauri/src/fs.rs`) — slow on network/OneDrive paths;
- `pty_write` can block if the PTY pipe is full (`src-tauri/src/pty.rs:361-371`).

This was flagged in `docs/QUALITY-REVIEW-2026-06-09.md` §3 as "the single
highest-leverage backend change." Making these commands `async` moves them to
Tauri's async runtime thread pool; the window stays responsive. The front-end
needs **zero changes** — `invoke()` already returns Promises.

## Current state

Relevant files:

- `src-tauri/src/lib.rs` — `invoke_handler` registering all 17 commands (lines 60-78), all sync.
- `src-tauri/src/pty.rs` — `pty_open`, `pty_write`, `pty_resize`, `pty_kill`, `is_pty_busy`, all `pub fn`, all take `State<'_, PtyRegistry>`.
- `src-tauri/src/git.rs` — `git_current_branch` (lines 27-52), no State.
- `src-tauri/src/shell_detect.rs` — `detect_shells` (line 65+), no State.
- `src-tauri/src/fs.rs` — `list_dir`, `read_text_file`, `write_text_file`, `home_dir`, no State.
- `src-tauri/src/config.rs` — `read_config`, `set_config_value`, `write_default_config_if_missing` do disk I/O; `watch_config`, `config_file_path` are cheap.

Excerpt — `src-tauri/src/git.rs:27-28` today:

```rust
#[tauri::command]
pub fn git_current_branch(path: String) -> Option<String> {
```

Excerpt — `src-tauri/src/pty.rs:202-211` today:

```rust
#[tauri::command]
pub fn pty_open(
    pane_id: String,
    shell: Shell,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    channel: Channel<InvokeResponseBody>,
    state: State<'_, PtyRegistry>,
) -> AppResult<()> {
```

Repo conventions to match:

- Errors: every fallible command returns `AppResult<T>` with the `AppError`
  thiserror enum (`src-tauri/src/error.rs`). Keep signatures' return types
  unchanged.
- No `unwrap()` in production paths.
- Comment style: explanatory header comments on each command (keep them).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Rust tests | `cd src-tauri; cargo test --lib` | all pass, exit 0 |
| Lint | `cd src-tauri; cargo clippy --all-targets -- -D warnings` | exit 0 |
| Format | `cd src-tauri; cargo fmt --all -- --check` | exit 0 |
| TS typecheck | `npm run typecheck` (repo root) | exit 0 |
| TS tests | `npm test` (repo root) | all pass |

## Scope

**In scope** (the only files you should modify):
- `src-tauri/src/pty.rs`
- `src-tauri/src/git.rs`
- `src-tauri/src/shell_detect.rs`
- `src-tauri/src/fs.rs`
- `src-tauri/src/config.rs`

**Out of scope** (do NOT touch):
- `src-tauri/src/lib.rs` — `generate_handler!` works identically for async commands; no edit needed. If you believe an edit is needed there, STOP and report.
- Any TypeScript file — `invoke()` is already Promise-based.
- `src-tauri/src/file_watcher.rs` and `shell_integration.rs` — cheap, stay sync.
- Command names, parameter names, return types — the TS side depends on them.

## Git workflow

- Branch: `advisor/001-async-tauri-commands`
- Commit style: conventional commits, e.g. `perf(rust): run blocking commands on the async pool, not the main thread` (matches repo history like `perf(pty): send terminal output as raw bytes, not JSON`).
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Convert the no-State blocking commands using `spawn_blocking`

For `git_current_branch`, `detect_shells`, `list_dir`, `read_text_file`,
`write_text_file`, `read_config`, `set_config_value`,
`write_default_config_if_missing`:

1. Extract the existing body into a private sync impl function (same module),
   e.g. `fn git_current_branch_impl(path: String) -> Option<String>`.
   The impl keeps ALL existing logic and comments.
2. Make the command a thin async wrapper:

```rust
#[tauri::command]
pub async fn git_current_branch(path: String) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || git_current_branch_impl(path))
        .await
        .unwrap_or(None)
}
```

For `AppResult<T>` commands, map a join error to the repo's error type instead
of unwrapping:

```rust
#[tauri::command]
pub async fn detect_shells() -> AppResult<Vec<ShellDescriptor>> {
    tauri::async_runtime::spawn_blocking(detect_shells_impl)
        .await
        .map_err(|e| AppError::internal(format!("task join: {e}")))?
}
```

Note: `AppError::internal(...)` — confirm the constructor name in
`src-tauri/src/error.rs` first (the codebase uses helpers like
`AppError::spawn(...)`, `AppError::internal { reason }` — match whichever
exists; do not invent a new one).

Leave `home_dir` and `config_file_path` sync (they're trivial).

**Verify**: `cd src-tauri; cargo clippy --all-targets -- -D warnings` → exit 0.

### Step 2: Convert the State-taking PTY commands to plain `async fn`

`pty_open`, `pty_write`, `pty_resize`, `pty_kill`, `is_pty_busy` take
`State<'_, PtyRegistry>`, which cannot move into a `spawn_blocking` closure.
For these, change only the signature from `pub fn` to `pub async fn` — body
unchanged. An async command is dispatched on the async runtime instead of the
main thread; the brief blocking inside (process spawn ~tens of ms, pipe write)
then ties up a worker thread, not the UI.

IMPORTANT Tauri v2 detail: async commands that borrow `State<'_, _>` work, but
if the compiler complains about lifetimes on `Channel`/`State` across the
(nonexistent) await points, the known-good pattern is to keep the borrow fully
synchronous inside the async fn (no `.await` anywhere in these bodies — there
is none today; keep it that way).

**Verify**: `cd src-tauri; cargo test --lib` → all pass (existing tests target
`shell_spec`, `RingBuf`, config parsing — they call impl logic, not commands).

### Step 3: Keep unit tests pointed at the sync impls

If any existing `#[cfg(test)]` test calls a function you made async (check
`config.rs` tests especially), repoint the test to the `_impl` function rather
than adding an async test harness.

**Verify**: `cd src-tauri; cargo test --lib` → all pass, same test count or
higher than before your change (run `cargo test --lib` on the base branch
first if you need the baseline count).

### Step 4: Full verification sweep

**Verify**, in order:
1. `cd src-tauri; cargo fmt --all` then `cargo fmt --all -- --check` → exit 0
2. `cd src-tauri; cargo clippy --all-targets -- -D warnings` → exit 0
3. `cd src-tauri; cargo test --lib` → all pass
4. `npm run typecheck` (repo root) → exit 0
5. `npm test` (repo root) → all pass (front-end is untouched; this catches accidental contract drift)

## Test plan

- No new TS tests (no TS changes).
- Rust: existing tests must keep passing against the `_impl` functions.
- Add one new Rust test only if an `_impl` extraction created a previously
  untestable seam worth pinning (e.g. `git_current_branch_impl` with a
  non-repo temp dir returns `None` — `tempfile` is already a dev-dependency).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `Select-String -Path src-tauri/src/git.rs,src-tauri/src/shell_detect.rs,src-tauri/src/fs.rs -Pattern "pub fn (git_current_branch|detect_shells|list_dir|read_text_file|write_text_file)\("` returns no matches (all are `pub async fn`)
- [ ] `Select-String -Path src-tauri/src/pty.rs -Pattern "pub fn pty_"` returns no matches
- [ ] `cd src-tauri; cargo test --lib` exits 0
- [ ] `cd src-tauri; cargo clippy --all-targets -- -D warnings` exits 0
- [ ] `npm run typecheck` and `npm test` exit 0
- [ ] `git status` shows no modified files outside the in-scope list
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- `generate_handler!` fails to compile with async commands and the fix appears
  to require editing `lib.rs` beyond zero changes.
- The `Channel<InvokeResponseBody>` parameter in `pty_open` does not compile
  inside an `async fn` (Send/lifetime error you cannot resolve by keeping the
  body await-free).
- Any existing test calls a command function directly in a way that can't be
  repointed to an `_impl` without changing test semantics.
- Manual smoke (if you can run `npm run tauri dev`): a terminal pane fails to
  spawn or keystrokes stop echoing.

## Maintenance notes

- Future commands that do I/O must follow this pattern: `async fn` wrapper +
  sync `_impl`, `spawn_blocking` when no State is borrowed. A reviewer should
  reject new sync blocking commands.
- Plan 002 (PTY flush rework) and Plan 003 (Job Objects) edit `pty.rs` after
  this lands; their excerpts show `pub fn` — the `async` keyword being present
  is EXPECTED drift for them, not a STOP.
- Deferred deliberately: making `watch_config` / `watch_workspace` async
  (watcher installation is cheap); front-end debounce of branch polling.
