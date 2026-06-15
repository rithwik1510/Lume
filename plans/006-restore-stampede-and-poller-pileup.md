# Plan 006: Readiness-gated sequential fleet-revive + single-flight git poller

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 0cc44a3..HEAD -- src/App.tsx src/sessions/branchPoller.ts src/store/sessionsStore.ts src/sessions/commandTracker.ts`
> On any structural mismatch with the "Current state" excerpts, STOP.

## Status

- **Priority**: P0 (written from a live incident on the maintainer's machine, 2026-06-12; design upgraded same day from fixed-interval stagger to readiness gating)
- **Effort**: M
- **Risk**: MED
- **Depends on**: none (pure TS; independent of plans 001-005). Plan 001 makes
  `git_current_branch` stop blocking the main thread — both fixes are wanted;
  this one also removes the unbounded queue growth and the load spike that
  001 alone would not.
- **Category**: bug / perf
- **Planned at**: commit `0cc44a3`, 2026-06-12

## Why this matters (observed incident)

With 6 sessions / 8 panes persisted (all with remembered startup command
`claude`), the maintainer's app entered a freeze-restart loop. Evidence
gathered live:

1. **Boot stampede.** `App.tsx:87-88` calls
   `resumeSessions(st.lastRunningSessionIds, st.lastActiveSessionId)` — ONE
   store write marks every revivable session `"active"`. The orchestrator's
   subscriber diff then spawns every pane in the same tick: the Rust log
   showed 8 `pty_open` calls within one second at each launch, and the
   process tree showed 8 `pwsh` + 7 `claude` children created in the launch
   second. Eight Claude Code instances initializing simultaneously saturates
   disk/CPU; the app appears frozen; the user force-closes; relaunch repeats
   the stampede.
2. **Poller pile-up.** `branchPoller.ts` fires `git_current_branch` per
   active session every 5s with **no overlap guard**: 6 sessions × slow git
   (system under load, 2s timeout each) can take >5s per cycle — and the
   interval fires again anyway. The backlog grows without bound and the UI
   freezes progressively harder the longer the app runs.

**Why readiness gating, not a fixed stagger:** a fixed 2s stagger was
considered and rejected — on a loaded machine `claude` takes 5-15s to
initialize, so a timer still accumulates 4-5 concurrent agent startups by
pane 8. Gating the NEXT session's revive on the PREVIOUS session's shells
actually reaching their prompt (the OSC 133 `prompt-ready` signal Lume
already consumes for autorun) bounds concurrent agent startups to ~1 on any
machine, while staying fast on fast machines. A 10s per-session timeout
covers shells that never emit OSC 133 (cmd, WSL).

After this plan: boot revives the focused session immediately; each further
session revives only when the previous one's autorun panes are ready (or
timed out); the poller never has two cycles in flight.

## Current state

- `src/App.tsx:84-90` (inside the boot effect):

```ts
        if (st.reopenLastSession && st.lastRunningSessionIds.length > 0) {
          st.resumeSessions(st.lastRunningSessionIds, st.lastActiveSessionId);
        }
```

- `src/store/sessionsStore.ts:306-319` — `resumeSessions(ids, activeId)`
  marks every id `"active"` in one immer write and focuses `activeId`
  (fallback: first revivable id present in `ids`). Existing tests:
  `src/store/sessionsStore.test.ts:536-556`.
- `src/store/sessionsStore.ts` also exports `paneLaunchSpec(state, paneId)`
  (returns `{ shell?, startupCommand? } | null`) — used by the orchestrator
  to decide autorun. Sessions store leaves via
  `leaves` from `src/store/layout/tree.ts` (see how
  `src/sessions/attentionTracker.ts:36-37` imports both — copy those imports).
- `src/sessions/commandTracker.ts` — exports
  `onCommandEvent(cb): () => void` (dispose). Events include
  `{ type: "prompt-ready", paneId }` — emitted when an OSC-133-integrated
  shell renders its prompt. This is the exact signal `armStartupAutorun` in
  `src/terminals/orchestrator.ts:267-281` already uses to type the remembered
  command.
- `src/sessions/branchPoller.ts` — `POLL_INTERVAL_MS = 5000` (line 14);
  `tick()` (lines 33-39) loops sessions and `void pollOne(s.id)` per active
  session — fire-and-forget, no overlap guard; `installBranchPoller` sets
  `setInterval(tick, POLL_INTERVAL_MS)` (line 83).
- Orchestrator behavior to rely on (do NOT modify it):
  `installPtyOrchestrator` diffs active paneIds per store write — so N
  separate `resumeSessions` calls produce N separate, smaller spawn batches,
  and each revived pane auto-runs its remembered command when its own shell
  reports prompt-ready.
- Conventions: Zustand stores under `src/store/`, vitest + fake timers (see
  `src/sessions/attentionTracker.test.ts`), `@/` path alias.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install (fresh worktree) | `npm install` | exit 0 |
| TS tests | `npm test` | all pass |
| Single file | `npx vitest run src/sessions/branchPoller.test.ts` | all pass |
| Typecheck | `npm run typecheck` | exit 0 |
| Manual run | `npm run tauri dev` | app opens |

## Scope

**In scope**:
- `src/sessions/branchPoller.ts`
- `src/sessions/branchPoller.test.ts` (create)
- `src/lib/sessions/sequentialResume.ts` (create) + `src/lib/sessions/sequentialResume.test.ts` (create)
- `src/App.tsx` (the `resumeSessions` call site only)

**Out of scope** (do NOT touch):
- `src/store/sessionsStore.ts` — `resumeSessions` keeps its semantics; the
  sequencing lives in the caller. Its tests stay green untouched.
- `src/terminals/orchestrator.ts` and `src/sessions/commandTracker.ts` —
  consume their exports; do not modify them.
- Rust side (Plan 001 owns the sync-command fix).
- The `reopenLastSession` setting and its UI.

## Git workflow

- Branch: `advisor/006-restore-stampede-and-poller-pileup`
- Commit style: `fix(sessions): readiness-gated boot revive; fix(git): single-flight branch poller`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Single-flight branch poller

In `src/sessions/branchPoller.ts`:

1. Add a module-level `let cycleInFlight = false;`.
2. Replace `tick()`'s fire-and-forget loop with a serialized cycle:

```ts
async function runCycle(): Promise<void> {
  if (cycleInFlight || !isFocused) return;   // skip, never stack
  cycleInFlight = true;
  try {
    const state = useSessionsStore.getState();
    for (const s of Object.values(state.sessions)) {
      if (s.status === "active") await pollOne(s.id);   // serial, one git at a time
    }
  } finally {
    cycleInFlight = false;
  }
}
function tick() { void runCycle(); }
```

3. Keep the immediate-poll-on-revive subscription (lines 72-80) — `pollOne`
   stays callable directly; it is already single-session.
4. Reset `cycleInFlight = false` inside `installBranchPoller()` (HMR safety,
   same spirit as the existing `isFocused = true` reset at line 43).

**Verify**: `npm run typecheck` → exit 0.

### Step 2: Test the poller (new file `src/sessions/branchPoller.test.ts`)

Use vi.mock for `@tauri-apps/api/core` (`invoke`) and
`@tauri-apps/api/window` (`getCurrentWindow` → `{ listen: vi.fn(async () => () => {}) }`),
plus `vi.useFakeTimers()`. Seed `useSessionsStore` with 3 active sessions
(follow the store-seeding pattern in `src/store/sessionsStore.test.ts`).

Cases:
1. `one tick polls each active session exactly once` — resolve invoke
   immediately; advance 5s; expect 3 invoke calls.
2. `a slow cycle is never overlapped` — invoke resolves after 12s fake time;
   advance 5s, then 10s: only the first cycle's calls exist; after resolution,
   a later tick runs again.
3. `polls are serial` — track in-flight count inside the mock; assert max
   concurrency is 1.
4. `blurred window polls nothing` — capture the blur listener from the mock,
   fire it, advance 5s, expect 0 new calls.

**Verify**: `npx vitest run src/sessions/branchPoller.test.ts` → 4 pass.

### Step 3: Readiness-gated sequential revive

New file `src/lib/sessions/sequentialResume.ts`:

```ts
// Boot fleet-revive, gated on shell readiness. Reviving N sessions in one
// store write made the orchestrator spawn every pane (and auto-run every
// remembered `claude`) in the same second — 2026-06-12 incident: 8
// simultaneous agent launches froze the machine into a force-close →
// re-stampede loop. A fixed stagger was rejected: on a loaded machine agent
// startup takes 5-15s, so a timer still piles up concurrent launches.
// Instead: revive the last-active session NOW; revive each further session
// only when the previous one's autorun panes have reported OSC 133
// prompt-ready (= shell up, remembered command typed) or a timeout passed.

export const SESSION_READY_TIMEOUT_MS = 10_000;
/** Small floor between revives even when readiness fires instantly. */
export const MIN_GAP_MS = 500;

export interface SequentialResumeDeps {
  /** sessionsStore.resumeSessions — revive these ids, focus activeId. */
  resumeOne(ids: string[], activeId: string | null): void;
  /** Subscribe to per-pane prompt-ready; returns dispose. */
  onPaneReady(cb: (paneId: string) => void): () => void;
  /** PaneIds of this session that will auto-run a remembered command —
   *  the expensive ones worth gating on. Empty array ⇒ plain shells. */
  autorunPaneIds(sessionId: string): string[];
}

export function sequentialResume(
  ids: string[],
  activeId: string | null,
  deps: SequentialResumeDeps,
  timeoutMs: number = SESSION_READY_TIMEOUT_MS,
  gapMs: number = MIN_GAP_MS
): () => void { /* … */ }
```

Algorithm (implement exactly):

1. `first` = `activeId` if present in `ids`, else `ids[0]`; if none, return a
   no-op cancel. `deps.resumeOne([first], first)` synchronously.
2. Maintain a queue of the remaining ids in order. For each step: wait until
   BOTH (a) every paneId in `deps.autorunPaneIds(prevSessionId)` has fired
   prompt-ready (subscribe once via `deps.onPaneReady`; a session with no
   autorun panes is immediately satisfied) OR the per-session `timeoutMs`
   elapsed since `prev` was revived — whichever first — AND (b) at least
   `gapMs` elapsed since `prev` was revived. Then
   `deps.resumeOne([next], first)` (keep focusing `first` so a later revive
   never steals focus — confirm against `resumeSessions`'s focus branch at
   `sessionsStore.ts:306-319`; if passing a focused id not contained in `ids`
   breaks it, pass `null` instead and assert focus stays on `first` in the
   integration test).
3. The returned cancel fn clears all timers and disposes the
   `onPaneReady` subscription. Idempotent.

Wire it in `src/App.tsx:87-88`:

```ts
        if (st.reopenLastSession && st.lastRunningSessionIds.length > 0) {
          cancelResume = sequentialResume(
            st.lastRunningSessionIds,
            st.lastActiveSessionId,
            {
              resumeOne: st.resumeSessions,
              onPaneReady: (cb) =>
                onCommandEvent((evt) => {
                  if (evt.type === "prompt-ready") cb(evt.paneId);
                }),
              autorunPaneIds: (sid) => {
                const state = useSessionsStore.getState();
                const sess = state.sessions[sid];
                if (!sess?.layoutRoot) return [];
                return leaves(sess.layoutRoot).filter(
                  (paneId) => !!paneLaunchSpec(state, paneId)?.startupCommand?.trim()
                );
              },
            }
          );
        }
```

Imports: `onCommandEvent` from `@/sessions/commandTracker`; `leaves` from
`@/store/layout/tree`; `paneLaunchSpec`, `useSessionsStore` from
`@/store/sessionsStore` (match the import shapes used in
`src/sessions/attentionTracker.ts:36-42`). Register `cancelResume` in the
boot effect's cleanup (add a cleanup return if the effect lacks one).

**Verify**: `npm run typecheck` → exit 0.

### Step 4: Test the sequencer (new file `src/lib/sessions/sequentialResume.test.ts`)

Fake timers; `deps` fully faked: `resumeOne` = `vi.fn()`; `onPaneReady`
returns a manual emitter you can fire from the test; `autorunPaneIds` from a
fixture map. Cases:

1. `focused session resumes synchronously, alone, focused` — 3 ids; only one
   `resumeOne` call so far, `([focused], focused)`.
2. `next session waits for previous readiness` — fire prompt-ready for all of
   session 1's autorun panes at t=3s; advance past `gapMs`; session 2 resumes
   at ~3s, NOT at `gapMs`.
3. `timeout fallback` — never fire readiness; session 2 resumes at
   `SESSION_READY_TIMEOUT_MS`, session 3 at 2× (with its own timeout).
4. `no-autorun session gates only on gapMs` — `autorunPaneIds` returns `[]`
   for session 1; session 2 resumes at `gapMs`.
5. `partial readiness keeps waiting` — session 1 has 2 autorun panes; fire
   one; advance to just under timeout: session 2 not resumed; fire the
   second: resumed.
6. `cancel stops everything` — cancel after the first revive; advance 60s;
   exactly 1 `resumeOne` call total; emitter disposed.
7. `stale activeId falls back to first id`; `empty ids is a no-op`.
8. Integration (real store, fake timers): seed 3 sessions via the pattern in
   `src/store/sessionsStore.test.ts:536`, run with real
   `resumeSessions`, drive readiness; after all revives,
   `activeSessionId` === the originally focused id and all sessions are
   `"active"`.

**Verify**: `npx vitest run src/lib/sessions/sequentialResume.test.ts` → all pass.

### Step 5: Full sweep + manual smoke

**Verify**: `npm test` → all pass; `npm run typecheck` → exit 0.

Manual (`npm run tauri dev`), with 3+ sessions saved as running and
remembered commands present:
1. Launch → last-active session's panes appear immediately; other sessions
   flip stopped→active one-by-one in the sidebar, each only after the
   previous session's agent reached its prompt (or ~10s).
2. The app stays clickable/minimizable throughout boot.
3. Each revived pane still auto-runs its remembered command.
If you cannot run the GUI, flag "NOT RUN — needs operator smoke test".

## Test plan

Steps 2 and 4 (12+ named cases across two new test files). Existing
`sessionsStore.test.ts` must pass unmodified — if it fails, you changed
semantics that are out of scope.

## Done criteria

ALL must hold:

- [ ] `Select-String -Path src/App.tsx -Pattern "st.resumeSessions\(st.lastRunningSessionIds"` → no matches
- [ ] `Select-String -Path src/App.tsx -Pattern "sequentialResume"` → ≥1 match
- [ ] `Select-String -Path src/sessions/branchPoller.ts -Pattern "cycleInFlight"` → ≥2 matches
- [ ] `npm test` exits 0 with the 2 new test files passing
- [ ] `npm run typecheck` exits 0
- [ ] `git status` clean outside the in-scope list and `plans/README.md`
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- `commandTracker`'s event type for prompt-ready does not match
  `{ type: "prompt-ready", paneId }` (check the actual exported types before
  writing the adapter; if different, report the actual shape).
- `resumeSessions`'s focus behavior cannot keep focus on the first session
  without editing `sessionsStore.ts` (out of scope — report what you observed).
- The boot effect in `App.tsx` is structured so cleanup registration is
  ambiguous (multiple nested async callbacks) — describe it instead of guessing.
- Existing `sessionsStore.test.ts` or orchestrator tests fail after your change.

## Maintenance notes

- Plan 001 (async commands) is the other half of this incident's fix: it
  removes main-thread blocking; this plan removes the workload spikes. Both
  should land.
- If a "revive all NOW" affordance is ever wanted, call `resumeSessions`
  directly with all ids — the gating is a boot policy, not a store rule.
- Future option (deferred): lazy revive as a user setting (background
  sessions stay stopped until clicked). Gating preserves today's
  "fleet comes back" UX, so it wasn't taken now.
- Reviewer focus: cancel path leaves no timers/subscriptions; test 3 proves
  bounded concurrency; no `setInterval`/`setTimeout` without cleanup.
