# Plan 007: Visibility-driven render governor — bound Lume's cost to what's on screen

> **Status of this document**: design + phased implementation plan. Authored
> 2026-06-20 after a deep-dive review of the multi-session freeze ("6–7
> terminals open, app froze for minutes, needed a restart"). This plan
> **supersedes the Rust half of Plan 002** (see "Relationship to other plans")
> because 002's uniform reader-backpressure would stall *background* agents,
> which violates Lume's core invariant. Read that section before touching
> `pty.rs`.

## Status

- **Priority**: P0 (the app's headline value — "a fleet of agents in one
  window" — does not hold past ~5 sessions today)
- **Effort**: L (Phase 1 M, Phase 2 M)
- **Risk**: MED (touches the hottest path; phased to de-risk)
- **Depends on**: 006 (DONE). Recommended-before: 001 (async commands) for
  Phase 2 only. Supersedes/extends: 002.
- **Category**: architecture / perf
- **Planned at**: commit `a9a8e7c`

---

## 1. The problem in one sentence

Lume keeps **every "active" session fully live and concurrent forever** — there
is no foreground/background distinction beyond CSS `display:none`. So the cost
of the app grows with *how many sessions you have ever opened*, not with *what
you are looking at*, and several of those costs hit hard cliffs at 6–7 sessions
simultaneously:

| Cost | Where it scales | Cliff |
|---|---|---|
| WebGL contexts (1 per pane) | `registry.ts:177` creates one on every `attach`; `MainArea.tsx:112` mounts every active session | WebView2 force-loses contexts past ~16 → DOM-renderer thrash |
| Main-thread xterm parsing | `orchestrator.ts:191` `writeToTerminal` runs for **every** pane regardless of visibility | N sustained streams saturate the one renderer thread → UI freeze |
| Memory | `scrollback_lines = 10000` × panes + 8 MB Rust ring × panes + a glyph atlas per context | hundreds of MB → swap → multi-minute stalls |

The freeze the maintainer hit is these three crossing at once while several
background agents flood output. It "recovers after a while" because the floods
eventually subside / the OS finishes swapping.

Full evidence is in the review; the load-bearing facts:

- `getActivePaneIds` (`sessionsStore.ts:652`) = union of leaves of **every**
  session with `status === "active"`. The orchestrator spawns + wires all of
  them.
- `orchestrator.ts:179-197`: the per-pane channel handler calls
  `writeToTerminal(paneId, bytes)` **unconditionally** — no visibility check.
- `MainArea.tsx:1-4` header comment states the intent outright: *"background
  PTYs keep writing into hidden buffers."*
- `registry.ts:177-188`: WebGL is created per pane on first attach and only
  freed in `disposeTerminal` — i.e. it lives for every pane that was ever shown.

---

## 2. Design principles (the invariants any fix must hold)

1. **Agents always run.** A backgrounded session's shell/agent process must keep
   making progress. We may stop *rendering* its output; we must never stall the
   *process*. This is the product. → **Background panes must use drop-oldest,
   never reader-backpressure.**
2. **What you watch is never corrupted.** For the visible pane, output must be
   lossless and ANSI-correct (no drop-oldest mid-escape-sequence). → **Visible
   panes use lossless flow control (backpressure).**
3. **You pay for what you see.** Main-thread parse cost, WebGL contexts, and IPC
   volume should be ~O(visible panes), not O(active sessions).
4. **Scrollback survives.** Switching sessions, splitting, shell-swaps must not
   recreate the xterm Terminal (that loses scrollback — DESIGN.md §10). The
   module-level registry stays the single owner (DESIGN.md §4 rule #2).
5. **PTY bytes never touch Zustand** (DESIGN.md §4 rule #1). Unchanged.
6. **Measure, don't guess.** Land a repeatable stress harness first; gate each
   phase on it.

Principles 1 + 2 are the key insight: **flow-control policy is a function of
visibility.** That single rule unifies "let background agents run" with "don't
corrupt what I'm watching" and tells us exactly what Plan 002 got half-right.

---

## 3. The model: two independent lifecycles

Today there is one axis: `stopped ⇄ active`. We add a second, orthogonal axis:

```
                       process lifecycle (owned by the orchestrator, today)
                       stopped ───────────────► active ───────────────► stopped
                                                  │
                                                  │  render lifecycle (NEW — owned by the render governor)
                                                  ▼
                                       hidden ⇄ visible
```

- **active / stopped** = is there a PTY process? (orchestrator, `getActivePaneIds`) — *unchanged.*
- **visible / hidden** = of the active panes, which are on screen right now?
  - **visible** = panes of the foreground session, plus both members of a split.
  - **hidden** = active but off-screen.

A pane is `visible` iff it is a leaf of `activeSessionId`'s layout **or** of a
`splitView` member's layout. New helper, mirrors `getActivePaneIds`:

```ts
// sessionsStore.ts
export function getVisiblePaneIds(state: SessionsState): PaneId[] {
  const ids = state.splitView ?? (state.activeSessionId ? [state.activeSessionId] : []);
  const out: PaneId[] = [];
  for (const sid of ids) {
    const root = state.sessions[sid]?.layoutRoot;
    if (root) out.push(...treeLeaves(root));
  }
  return out;
}
```

Everything below is driven by transitions in this visible set.

---

## 4. Behaviour matrix (the whole design on one screen)

| Concern | Visible pane | Hidden pane | On hidden→visible | On visible→hidden |
|---|---|---|---|---|
| PTY process | running | **running** (never stalled) | — | — |
| Buffer overflow policy | **backpressure** (block reader at high-water; lossless) | **drop-oldest** (bounded ring; agent never blocks) | switch ring to backpressure | switch ring to drop-oldest |
| xterm writes | live, coalesced | **suspended** | drain ring → replay (line-resynced) → go live | stop writing |
| WebGL context | acquired (LRU pool) | evictable | acquire (LRU bump) | leave; evicted lazily when pool needs room |
| Attention tracker | per-chunk (throttled) | fed by coalesced "activity" tick | — | — |
| IPC (Phase 2) | full byte stream | only tiny activity ticks | burst-drain then live | stop sending bytes |

The two columns "Visible" and "Hidden" are the same buffer with a different
policy bit. That is the elegance: **one mechanism, switched by visibility.**

---

## 5. Components

Three new TS modules + one Rust change. Each has a single responsibility.

### 5.1 `src/terminals/webglPool.ts` — bound WebGL contexts (solves the cliff)

Today WebGL is created in `attach()` and lives forever. Replace with a pool:

- Move WebGL creation out of `registry.attach()` Path 3. `attach` only does
  `term.open()` (DOM renderer by default) + reparent.
- `webglPool.acquire(paneId)`: if the entry has no WebGL, create + `loadAddon`;
  push to MRU. If live contexts now exceed `CAP`, dispose the least-recently-used
  **hidden** pane's WebGL (never a visible one). DOM-renderer fallback is
  automatic and lossless (buffer is renderer-independent).
- `webglPool.markBackground(paneId)`: move to LRU tail (evictable), do **not**
  dispose yet — keeps recently-used sessions warm so a quick switch-back has no
  atlas-regeneration flash (DESIGN.md §10 risk #9).
- `CAP = 8` warm target, hard ceiling 12 (< WebView2's ~16, leaving headroom).
  Visible panes are always granted WebGL even if that transiently exceeds CAP;
  only hidden panes are evicted.

> **Spike first (½ day, gates Phase 1):** confirm `WebglAddon.dispose()` then
> `loadAddon(new WebglAddon())` on an existing Terminal re-renders correctly and
> preserves the buffer. This is the one load-bearing xterm assumption. VS Code
> does exactly this on GPU context loss, so it should hold, but verify before
> building on it. Fallback if flaky: keep WebGL for visible panes only and never
> recreate — cold sessions render via the DOM renderer permanently (still solves
> the cliff, slightly worse cold-switch perf).

### 5.2 `src/terminals/renderSink.ts` — route bytes by visibility (solves the freeze)

Owns the per-pane hold buffer and the live/buffered routing. The orchestrator's
channel handler stops calling `writeToTerminal` directly and calls `ingest`.

```ts
// Bounded per-pane byte ring (drop-oldest) for hidden panes.
const hold = new Map<PaneId, Uint8RingBuffer>();   // cap e.g. 4 MB/pane

// Called from orchestrator.onmessage for every Raw chunk.
export function ingest(paneId: PaneId, bytes: Uint8Array): void {
  if (isVisible(paneId)) writeToTerminal(paneId, bytes);  // live
  else holdFor(paneId).push(bytes);                        // buffer (drop-oldest)
}

// Called by the governor at the hidden→visible transition. Synchronous &
// atomic: no await, so no onmessage can interleave and reorder bytes.
export function foreground(paneId: PaneId): void {
  const buf = holdFor(paneId).takeAll();          // clears the ring
  // mark visible BEFORE writing so any chunk queued behind us appends AFTER
  setVisible(paneId, true);
  if (buf.length) writeToTerminal(paneId, resync(buf));   // replay
}

export function background(paneId: PaneId): void { setVisible(paneId, false); }
```

- `isVisible` is backed by the governor's authoritative visible set (single
  source of truth — no per-pane mode flags to drift).
- `resync(buf)`: drop bytes before the first `\n` (or first `ESC`) so a
  drop-oldest boundary can't feed xterm half an escape sequence. For
  alternate-screen TUIs (Claude/agents) the next full repaint self-heals anyway;
  this just keeps plain scrollback clean.
- Replaying up to 4 MB is one `term.write`; xterm chunks + yields internally and
  paints the *final* state once (writes are decoupled from rendering), so the
  user sees the stale last screen, then the fresh screen ~100–300 ms later. No
  visible scroll-through.
- `markActivity` + `noteOutput` still fire for hidden chunks (both already
  throttled to 200 ms — cheap), so the sidebar attention dot is unaffected.

### 5.3 `src/terminals/renderGovernor.ts` — the policy that drives 5.1 + 5.2

```ts
export function installRenderGovernor(): () => void {
  let prev = new Set(getVisiblePaneIds(useSessionsStore.getState()));
  applyVisible(prev, new Set());                 // initial
  return useSessionsStore.subscribe((state) => {
    const next = new Set(getVisiblePaneIds(state));
    if (sameSet(next, prev)) return;
    applyVisible(next, prev);
    prev = next;
  });
}

function applyVisible(next: Set<PaneId>, prev: Set<PaneId>) {
  for (const id of next) if (!prev.has(id)) {     // became visible
    webglPool.acquire(id);
    renderSink.foreground(id);                    // replay + go live
    ptyClient.setVisible?.(id, true);             // Phase 2 no-op until wired
  }
  for (const id of prev) if (!next.has(id)) {      // became hidden
    renderSink.background(id);
    webglPool.markBackground(id);
    ptyClient.setVisible?.(id, false);            // Phase 2
  }
}
```

Installed once in `App.tsx` next to `installPtyOrchestrator()`. Recomputes on
any sessions-slice change, so it also catches a split inside the visible session
(new leaf → becomes visible) without special-casing.

**Default for newly-spawned panes:** `ingest` defaults a pane it has never seen
to *hidden* (buffer) and the governor flips the foreground ones to visible on
the same store tick. Worst case a foreground pane buffers for one tick (~ms)
then replays — invisible to the user, and race-free because `foreground` is
synchronous.

### 5.4 Rust: visibility-aware `PaneBuffer` (Phase 2 — folds in Plan 002)

Plan 002 already wants to replace the 32 ms sleep-poll flusher with a condvar
and replace drop-oldest with reader-backpressure. We implement 002's machinery
**plus** a per-pane `visible: AtomicBool` that selects the policy:

```rust
struct PaneBuffer {
    ring: Mutex<RingBuf>,
    data_cv: Condvar,   // reader → flusher
    space_cv: Condvar,  // flusher → reader (backpressure release)
    closed: Mutex<bool>,
    visible: AtomicBool, // NEW: drives overflow + flush policy
}
```

- **Reader** (`push`): if `visible` → block at `HIGH_WATER` (Plan 002's lossless
  XOFF — the child stalls, fine, you're watching). If `!visible` → `ring.push`
  (drop-oldest, **never blocks the agent**). The agent keeps running either way
  when hidden.
- **Flusher**: if `visible` → condvar-wait for data, coalesce ~8 ms, drain →
  `Channel::Raw` (Plan 002). If `!visible` → do **not** send bytes; when the
  ring has grown, emit a coalesced `PtyEvent::Activity` (≤ 1 / 250 ms) so JS
  attention works, and otherwise sleep on the condvar (no idle wakeups — also
  fixes the §4 idle-wakeup finding).
- **Transition** `pty_set_visible(ids, true)`: set `visible`, `data_cv.notify` —
  the flusher drains the accumulated ring (chunked ≤ 1 MB/send = the replay) then
  resumes live; the reader switches to backpressure. `false`: set `visible`,
  reader switches to drop-oldest, flusher stops sending bytes.
- New batched command `pty_set_visible(paneIds: Vec<String>, visible: bool)`.
  The governor calls it; **JS is the single source of truth**, Rust obeys
  idempotently. With Phase 2 live, the JS hold-buffer (5.2) is removed — Rust's
  ring is the hold buffer, so hidden panes cost **zero IPC + zero JS handler +
  zero parse**.

This is strictly better than Plan 002 alone: 002's uniform backpressure would
freeze background agents; gating it on `visible` keeps them running.

---

## 6. Phasing (each phase independently shippable + measurable)

**Phase 0 — Stress + measurement harness (do first).** A dev-only command that
spawns N panes across M sessions each flooding output, plus three live readouts:
(a) main-thread responsiveness via a rAF jank meter, (b) live WebGL context
count (`entries` with `webgl !== null`), (c) `performance.memory`. This is the
gate for every later phase. ~½ day.

**Phase 1 — TS-only render governor (ships the sustainability fix, zero Rust
risk).** 5.1 WebGL pool + 5.2 JS hold-buffer sink + 5.3 governor. Rust untouched
(still flushes every pane; JS decides render-vs-buffer). After this the freeze
and the WebGL cliff are gone; remaining cost is hidden-pane IPC + a cheap JS
ring append. Fully unit-testable in jsdom. **This is the milestone that makes
the app sustainable.**

**Phase 2 — Rust visibility-aware buffer (folds in Plan 002; the last ~15%).**
5.4. Condvar flush + visibility-gated backpressure/drop-oldest + `pty_set_visible`
+ `Activity` event. Removes the JS hold-buffer. Hidden panes become ~free.
Resolves Plan 002 correctly. Land after Phase 1 is measured green.

**Phase 3 — tuning (optional, measure-driven).** Lower default scrollback or trim
hidden panes' scrollback; soft-warn (not silently cap) past ~6 active sessions;
back off branch polling for OneDrive/UNC paths. Each gated on the harness.

---

## 7. Edge cases & correctness

- **Replay ordering** (hidden→visible): `foreground()` is synchronous — take
  ring, mark visible, write — so a `Channel` callback queued behind it runs
  after and appends live bytes *after* the replay. No reorder.
- **Multi-pane visible session needing > CAP contexts:** visible panes are never
  evicted; pool ceiling flexes up to 12. A session with > 12 visible panes (no
  realistic use) degrades extra panes to DOM renderer — still correct.
- **Atlas flash on cold switch:** mitigated by the warm LRU pool (recent sessions
  keep WebGL). Only a truly cold session regenerates its atlas — one frame, same
  as a theme switch (already accepted).
- **Boot:** `sequentialResume` (006) revives sessions one at a time; only the
  focused one is visible, so the other N−1 spawn *hidden* (buffered, no WebGL).
  Boot now staggers both process spawn *and* render. The two plans compose.
- **Drop-oldest artifact on a hidden pane's replay:** bounded by `resync()` to a
  line boundary; TUIs self-heal on next repaint. Acceptable because principle 2
  (no corruption) applies to *visible* panes only.
- **Theme/font reapply** (`applyXtermThemeToAll`): still iterates all entries;
  fine for hidden panes (cheap, no repaint until shown).

---

## 8. Test strategy

- **webglPool**: LRU order, never-evict-visible, CAP enforcement, acquire/evict
  idempotency. Mock `WebglAddon` (jsdom has no WebGL) — assert create/dispose
  call counts, not pixels.
- **renderSink**: drop-oldest bound; `resync` trims to first newline/ESC;
  `foreground` replay ordering incl. a chunk arriving mid-transition; `ingest`
  routes live vs buffered off `isVisible`; `forget` cleanup on pane kill.
- **renderGovernor**: visible-set diff across {no-split, split open/close,
  session switch, split inside visible session, multi-pane session}; correct
  acquire/foreground/background calls; attention `noteOutput` still fires for
  hidden ingest.
- **Rust (Phase 2)**: extend Plan 002's PaneBuffer thread tests with a `visible`
  axis — hidden push never blocks at high-water (agent doesn't stall); visible
  push blocks + resumes; `set_visible(true)` drains the ring in order then goes
  live; `Activity` coalescing ≤ 1/250 ms.
- **Regression**: `npm test` + `cargo test --lib` stay green; existing
  attentionTracker / commandTracker / orchestrator suites unchanged in contract.

---

## 9. Validation (the numbers that decide success)

Against the Phase 0 harness, with **7 sessions × 2 panes, 4 flooding**:

| Metric | Today (expected) | Phase 1 target | Phase 2 target |
|---|---|---|---|
| Live WebGL contexts | 14 → context-loss thrash | ≤ 12, no loss events | ≤ 12 |
| Main-thread long-task during flood | seconds (freeze) | < 50 ms p99, UI interactive | < 50 ms p99 |
| Background IPC msgs/sec | ~31 × hidden panes | ~31 × hidden (unchanged) | ≈ 0 (activity ticks only) |
| Switch-to-busy-session latency | n/a (already live) | < 300 ms catch-up | < 300 ms |
| RSS @ 14 panes | unbounded-ish | bounded, scrollback-dominated | same |

Ship a phase only when its column is green and no regression in the others.

---

## 10. Relationship to other plans

- **006 (DONE)** — sequential boot revive. Composes; this plan extends the
  same "stagger the herd" idea from boot into steady state.
- **002 (TODO) — SUPERSEDED/EXTENDED.** Do **not** implement 002 standalone: its
  uniform reader-backpressure stalls background agents (violates principle 1).
  Phase 2 here implements 002's condvar + backpressure machinery *gated on
  `visible`*. Mark 002 "FOLDED INTO 007" in `plans/README.md`.
- **001 (TODO)** — async Tauri commands. Recommended before Phase 2 (both edit
  `pty.rs`); not needed for Phase 1.
- **003 (TODO, Job Objects)** — independent; lands after Phase 2 on `pty.rs` per
  the existing 002→003 ordering note.

---

## 11. Out of scope (named so they're not re-litigated)

- **Process-count cap.** Running 20 agents is 20 heavy processes — the user's
  CPU/RAM, the user's choice. We bound *Lume's* overhead, not the agents'. A
  soft warning past ~6 is Phase 3, not a silent cap.
- **xterm parsing in a Web Worker / OffscreenCanvas.** Not production-ready in
  xterm 5.5; suspension (don't parse hidden) gets the same main-thread relief
  without it. Revisit if hidden-pane catch-up ever needs to be invisible.
- **File-watcher firehose over OneDrive trees** (review finding #5) and **git
  timeout hard-kill** (#6) — separate small fixes; not on this path.

---

## 12. Why this is the right architecture (one paragraph)

The whole design reduces to a single invariant — **flow-control and render cost
are functions of visibility** — applied consistently from the GPU (WebGL pool)
through the renderer (suspend/replay) down to the transport (visibility-gated
backpressure in Rust). It preserves the two things that actually matter — agents
keep running, and what you watch is never corrupted — while making everything
else O(what's on screen). It also turns the pending Plan 002 from a latent
agent-stalling bug into the correct lossless-when-visible path. Nothing is
bolted on; one idea governs the stack.
