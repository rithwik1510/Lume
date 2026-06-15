# Plan 002: Event-driven PTY flush + reader backpressure (no more drop-oldest corruption)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 0cc44a3..HEAD -- src-tauri/src/pty.rs`
> EXPECTED drift if Plan 001 landed: the five `#[tauri::command]` functions are
> `pub async fn` instead of `pub fn`. That is fine. Any OTHER structural
> mismatch with the "Current state" excerpts is a STOP condition.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED
- **Depends on**: plans/001-async-tauri-commands.md (touches the same file; land 001 first to avoid conflicts)
- **Category**: bug / perf
- **Planned at**: commit `0cc44a3`, 2026-06-12

## Why this matters

Two problems live in the same data path in `src-tauri/src/pty.rs`:

1. **Silent corruption under load.** The per-pane ring buffer caps at 8 MB and
   **drops the oldest bytes** on overflow (`RingBuf::push`, lines 83-94). A
   drop boundary can split an ANSI escape sequence, leaving xterm.js in a
   broken mode (stuck color, broken cursor) with no recovery except killing
   the pane. `cat` of a large file or a very chatty agent triggers it.
2. **Latency + idle wakeups.** The flusher thread is a fixed
   `thread::sleep(32ms)` loop (line 313). Every keystroke echo waits up to
   32 ms extra (Windows Terminal paces ~8 ms), and every idle pane still wakes
   ~31 times/sec, forever.

Both were flagged in `docs/QUALITY-REVIEW-2026-06-09.md` (§2, §5) and verified
still present at the planned-at commit. The fix replaces sleep-polling with a
condvar-driven flusher (flush immediately when output arrives after idle,
coalesce ~8 ms under load, zero wakeups when idle) and replaces drop-oldest
with **reader-thread blocking** at a high-water mark — the ConPTY pipe then
fills and the child process itself stalls, which is free, lossless flow
control (XOFF semantics).

## Current state

File: `src-tauri/src/pty.rs` (the only file in scope, plus its tests).

Key excerpts at `0cc44a3`:

```rust
// line 37
const FLUSH_INTERVAL_MS: u64 = 32;
// line 40
const RING_BUFFER_BYTES: usize = 8 * 1024 * 1024;
```

Reader thread (lines 288-305):

```rust
thread::spawn(move || {
    let mut buf = [0u8; 64 * 1024];
    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                ring.lock().push(&buf[..n]);
            }
            Err(_) => break,
        }
    }
    *closed.lock() = true;
});
```

Flusher thread (lines 307-339): `loop { thread::sleep(32ms); ... }`, drains
the ring, `ch.send(InvokeResponseBody::Raw(drained))`, and **on send error
breaks WITHOUT setting `closed`** (line 326-327) — the reader never learns the
channel died (minor leak: one thread + up to 8 MB ring per orphan until PTY EOF).

Shared state today: `closed: Arc<Mutex<bool>>` + `ring: Arc<Mutex<RingBuf>>`
(parking_lot Mutex — `use parking_lot::Mutex;` line 27). `pty_kill`
(lines 395-406) sets `closed` and kills the child.

Architectural law this plan must preserve (DESIGN.md §4 rule 1, quoted):
"PTY bytes NEVER touch any Zustand store. Flow: Rust portable-pty → batched
bytes via Tauri v2 `Channel<Vec<u8>>` (NOT `app.emit`) → JS handler →
`terminal.write(bytes)`." Data must keep flowing as
`InvokeResponseBody::Raw` — never JSON.

`config.toml` exposes `terminal.ipc_batch_ms = 32` (DESIGN.md §6). This plan
does not wire that config value (it isn't wired today either); constants stay
in `pty.rs`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Rust tests | `cd src-tauri; cargo test --lib` | all pass, exit 0 |
| Lint | `cd src-tauri; cargo clippy --all-targets -- -D warnings` | exit 0 |
| Format | `cd src-tauri; cargo fmt --all -- --check` | exit 0 |
| Manual run | `npm run tauri dev` (repo root) | app opens, terminal echoes |

## Scope

**In scope**:
- `src-tauri/src/pty.rs` (including its `#[cfg(test)] mod tests`)

**Out of scope** (do NOT touch):
- `src/terminals/*` (TS side) — the Channel contract is unchanged.
- `src-tauri/src/lib.rs`, `Cargo.toml` — parking_lot already ships `Condvar`.
- `RingBuf`'s public API used by existing tests — extend, don't break.
- Job objects / kill-tree behavior — that is Plan 003.

## Git workflow

- Branch: `advisor/002-pty-flush-and-backpressure`
- Commit style: conventional commits, e.g. `perf(pty): condvar-driven flush + reader backpressure, drop drop-oldest`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Introduce a `PaneBuffer` struct that owns the synchronization

In `pty.rs`, add (with `use parking_lot::{Condvar, Mutex};`):

```rust
/// High-water mark: reader blocks when the ring holds this much undelivered
/// data. The ConPTY pipe then fills and the child stalls — lossless flow
/// control instead of drop-oldest corruption.
const HIGH_WATER_BYTES: usize = 1024 * 1024;
/// Coalescing window once data starts flowing. First chunk after idle is
/// flushed after at most this delay; sustained streams batch at this cadence.
const COALESCE_MS: u64 = 8;

struct PaneBuffer {
    ring: Mutex<RingBuf>,
    /// Reader → flusher: "data available". Flusher waits here when idle.
    data_cv: Condvar,
    /// Flusher → reader: "drained below high water". Reader waits here when full.
    space_cv: Condvar,
    closed: Mutex<bool>,
}

impl PaneBuffer {
    fn new(cap: usize) -> Self { /* ring: RingBuf::new(cap), cvs, closed: false */ }

    /// Reader side. Blocks while ring >= HIGH_WATER and not closed.
    fn push_blocking(&self, bytes: &[u8]) {
        let mut ring = self.ring.lock();
        while ring.len() >= HIGH_WATER_BYTES && !*self.closed.lock() {
            self.space_cv.wait_for(&mut ring, Duration::from_millis(250));
        }
        if *self.closed.lock() { return; }
        ring.push(bytes);
        self.data_cv.notify_one();
    }

    /// Flusher side. Waits for data (or close), coalesces COALESCE_MS, drains.
    /// Returns None when closed AND empty (time to exit).
    fn wait_drain(&self) -> Option<Vec<u8>> {
        let mut ring = self.ring.lock();
        while ring.is_empty() {
            if *self.closed.lock() { return None; }
            self.data_cv.wait_for(&mut ring, Duration::from_millis(1000));
        }
        drop(ring);                                  // release while coalescing
        thread::sleep(Duration::from_millis(COALESCE_MS));
        let mut ring = self.ring.lock();
        let out = ring.drain_all();
        self.space_cv.notify_one();
        if out.is_empty() { /* raced a concurrent drain */ return Some(out); }
        Some(out)
    }

    fn close(&self) {
        *self.closed.lock() = true;
        self.data_cv.notify_all();
        self.space_cv.notify_all();
    }
}
```

Lock-ordering rule (state it in a comment): `closed` is only ever locked
*while holding* `ring` or alone — never take `ring` while holding `closed`.
parking_lot `Condvar::wait_for` requires the waited-on mutex guard (`ring`);
the timeouts (250 ms / 1000 ms) exist solely so a missed notify can never hang
forever.

Keep `RingBuf` and ALL its existing tests untouched: with backpressure at
1 MiB the 8 MB cap is now an unreachable safety net, but it stays.

**Verify**: `cd src-tauri; cargo clippy --all-targets -- -D warnings` → exit 0
(new code may be momentarily unused; `#[allow(dead_code)]` is NOT acceptable —
proceed to Step 2 in the same commit if needed).

### Step 2: Rewire `pty_open`'s three threads onto `PaneBuffer`

In `pty_open`:
- Replace `let closed = Arc::new(Mutex::new(false));` and
  `let ring = Arc::new(Mutex::new(RingBuf::new(RING_BUFFER_BYTES)));` with
  `let buffer = Arc::new(PaneBuffer::new(RING_BUFFER_BYTES));`.
- `PtySession.closed: Arc<Mutex<bool>>` becomes `buffer: Arc<PaneBuffer>`
  (the session needs it so `pty_kill` and the re-open teardown can call
  `close()`).
- Reader thread: `ring.lock().push(..)` → `buffer.push_blocking(..)`;
  on EOF/error: `buffer.close()` (replaces `*closed.lock() = true`).
- Flusher thread becomes:

```rust
thread::spawn(move || {
    while let Some(drained) = buffer.wait_drain() {
        if drained.is_empty() { continue; }
        if ch.send(InvokeResponseBody::Raw(drained)).is_err() {
            buffer.close();          // fixes the silent-orphan bug: reader unblocks and exits
            break;
        }
    }
});
```

(The old "one final flush after closed" block is now handled naturally:
`wait_drain` keeps returning data until the ring is empty, and only then
returns `None` when closed.)
- `pty_open`'s idempotent re-open teardown (lines 214-217) and `pty_kill`
  (line 398): replace `*prev.closed.lock() = true;` / `*session.closed.lock() = true;`
  with `prev.buffer.close();` / `session.buffer.close();`.
- Delete `FLUSH_INTERVAL_MS` (and its DESIGN.md §6 reference comment — update
  the file-header comment block, lines 1-18, to describe the new
  condvar/backpressure design).

**Verify**: `cd src-tauri; cargo test --lib` → all existing tests pass.

### Step 3: Unit-test `PaneBuffer` with real threads

Add to `mod tests`:

1. `panebuffer_delivers_bytes_in_order` — writer thread pushes `b"abc"`, then
   `b"def"`; consumer collects via `wait_drain` until 6 bytes total;
   assert concatenation is `b"abcdef"` (no loss, order kept).
2. `panebuffer_blocks_reader_at_high_water_and_resumes` — push
   `HIGH_WATER_BYTES` of data; spawn a thread pushing one more chunk and a
   flag it sets after `push_blocking` returns; assert the flag is still false
   after ~50 ms (reader blocked); then `wait_drain()` once; join with timeout
   and assert the flag flipped (reader resumed). No sleeps longer than 250 ms.
3. `panebuffer_close_unblocks_blocked_reader` — same setup, but call
   `close()` instead of draining; the pushing thread must return promptly;
   assert pushed-after-close data is NOT in the ring.
4. `panebuffer_wait_drain_returns_none_when_closed_and_empty` — close an
   empty buffer; `wait_drain()` → `None` within the 1 s wait timeout.

**Verify**: `cd src-tauri; cargo test --lib` → all pass including 4 new tests.

### Step 4: Manual smoke test (the §9 acceptance shape)

Run `npm run tauri dev`. In the app:

1. One pane: type — echo feels instant (no 32 ms mush).
2. Same pane: `Get-Content` (or `cat`) a multi-MB text file — output streams,
   **no garbled colors / broken rendering after it finishes**, prompt returns
   cleanly, and typing afterwards works.
3. Open 3 more panes, leave them idle ~30 s — Task Manager CPU for the app at
   ~0% (idle wakeups gone).
4. Close a pane mid-stream — no crash; other panes unaffected.

**Verify**: all four observations hold. If you cannot run the GUI in your
environment, mark this step "NOT RUN — needs operator smoke test" in your
report and in the README status note; do not silently skip it.

### Step 5: Format + final sweep

**Verify**: `cargo fmt --all -- --check`, `cargo clippy --all-targets -- -D warnings`,
`cargo test --lib` all exit 0; `npm run typecheck` and `npm test` (repo root)
still exit 0 (no TS files changed — this is a tripwire).

## Test plan

Covered in Step 3 (four named thread-level tests) plus the untouched RingBuf
suite. Model the test style on the existing `mod tests` in `pty.rs`
(plain `#[test]`, no async).

## Done criteria

ALL must hold:

- [ ] `Select-String -Path src-tauri/src/pty.rs -Pattern "FLUSH_INTERVAL_MS"` → no matches
- [ ] `Select-String -Path src-tauri/src/pty.rs -Pattern "thread::sleep"` → matches only the COALESCE_MS sleep inside `wait_drain` (exactly one)
- [ ] `cd src-tauri; cargo test --lib` exits 0 with the 4 new PaneBuffer tests present
- [ ] `cargo clippy --all-targets -- -D warnings` and `cargo fmt --all -- --check` exit 0
- [ ] Step 4 smoke test recorded as passed, or explicitly flagged NOT RUN
- [ ] `git status` clean outside `src-tauri/src/pty.rs` and `plans/README.md`
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- The flusher/reader threads in the live code no longer match the three-thread
  shape excerpted above (someone restructured pty.rs beyond Plan 001's
  async-keyword drift).
- Any new test deadlocks or is flaky across 3 consecutive
  `cargo test --lib` runs.
- The smoke test shows echo latency visibly WORSE than before, or pane close
  hangs the app — the condvar design has a flaw; report, don't patch around it.
- You find yourself wanting to change the TS Channel handler — that is out of
  scope and means the Rust-side contract broke.

## Maintenance notes

- Plan 003 (Job Objects) edits `pty_open`/`pty_kill` next; it must call
  `buffer.close()` exactly where `closed` was set before.
- If `terminal.ipc_batch_ms` from `config.toml` is ever wired up, it should
  map to `COALESCE_MS` — note the rename in DESIGN.md §6 when that happens.
- Reviewer focus: lock ordering in `PaneBuffer` (the comment rule in Step 1),
  and that `close()` is called on EVERY exit path (reader EOF, send error,
  pty_kill, idempotent re-open).
- Deferred deliberately: ack-based flow control (VS Code-style) — blocking the
  reader is simpler and sufficient; revisit only if WSL panes show stalls.
