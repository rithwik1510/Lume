// Attention tracker — drives the sidebar's two session signals:
//
//   working  → animated ring   ("an agent/command is actively running here")
//   unread   → accent dot      ("finished / needs you — look at this session")
//
// Signal hierarchy (most exact wins, per pane):
//
//   1. OSC 133 command lifecycle (commandTracker) — GROUND TRUTH. Lume injects
//      a shell-integration script into PowerShell-family shells, so the shell
//      itself reports prompt / command-start / command-finished(+exit code).
//      For an integrated pane the cadence signals are SCOPED to running
//      commands — that's the whole trick:
//        at prompt → output is noise (repaints, resize echo): ignored. No
//                    spinner, no dot. An idle shell can never false-positive.
//        running   → spinner. Output = the agent is working; quiet ≥
//                    QUIET_MS = it finished a turn / blocked on input → dot
//                    (turn-level detection for agents living inside one
//                    long-running command, e.g. `claude`). Output resuming
//                    clears the dot and brings the spinner back.
//        133;D     → command finished → dot, spinner off, exact.
//   2. BEL / OSC 9/99/777 — explicit agent cues (Claude Code & co. ring these
//      when they finish a turn or block on a permission prompt). Instant dot,
//      even mid-command.
//   3. Output cadence — FALLBACK for panes with no integration (cmd, WSL).
//      Unscoped: streaming = spinner; quiet after activity = dot. Imperfect,
//      but only used where the shell can't tell us more.
//
// Multi-pane sessions OR their panes: working if ANY pane works; one dot per
// session. bumpUnread no-ops for visible sessions (the foreground session, or
// both split-view sessions) so a terminal you're looking at never begs for
// attention.
//
// Hot-path discipline: noteOutput is called from the PTY byte sink, so it is
// throttled per pane (OUTPUT_THROTTLE_MS) and resolves pane→session through a
// cache instead of walking every session's layout tree per chunk.

import {
  useSessionsStore,
  findSessionForPane,
  getVisibleSessionIds,
  type SessionId,
} from "@/store/sessionsStore";
import { leaves as treeLeaves } from "@/store/layout/tree";
import {
  onCommandEvent,
  paneCommandState,
  forgetPaneCommandState,
} from "@/sessions/commandTracker";
import type { PaneId } from "@/types";

/** Quiet-after-activity window that counts as "finished a turn / waiting".
 *  TUI agents (Claude Code & co.) redraw their status line roughly once a
 *  second while genuinely working, so 5s of true silence reliably means the
 *  turn ended or the agent is blocked on a question — while staying well
 *  clear of mid-work think-pauses. This is also the worst-case latency
 *  between "agent asked you something" and the dot appearing, so keep it as
 *  tight as the heartbeat allows. Exported for tests. */
export const QUIET_MS = 5000;

/** Per-pane throttle for noteOutput (PTY byte-sink hot path). */
const OUTPUT_THROTTLE_MS = 200;

/** Ignore a backgrounded session's output for this long after switching away.
 *  Leaving a session makes its terminals repaint (focus-out redraws, display
 *  toggles, fits) — bytes that LOOK like activity but are echoes of the
 *  switch itself. Without this, leaving an idle agent showed a phantom
 *  spinner→dot sequence for a terminal where nothing happened. */
const BACKGROUND_GRACE_MS = 1500;

/** Ignore a pane's output briefly after a fit/resize — the PTY resize makes
 *  full-screen apps redraw, which is repaint noise, not activity. */
const RESIZE_MUTE_MS = 800;

/** ONE chunk of output is not work. Idle TUIs emit isolated repaints every
 *  few seconds (Claude Code rotates tips / refreshes its status line while
 *  sitting at its input box) — without this gate each repaint flipped the
 *  spinner back on and wiped the needs-you dot, so an agent that was merely
 *  OPEN oscillated spinner→dot forever. A pane only counts as streaming when
 *  a second (throttled) note lands within this window of the first; a
 *  genuinely working agent emits many chunks per second, so the spinner cost
 *  is ~one throttle tick of extra latency. Exported for tests. */
export const SUSTAIN_MS = 1000;

// ---------------------------------------------------------------------------
// Per-pane state (module-level — none of this belongs in Zustand)
// ---------------------------------------------------------------------------

/** Panes with live output (or a just-started command) — the ONLY driver of
 *  the working spinner. A command that started long ago but sits silent
 *  (an agent waiting at its input box) is not "working". */
const streamingPanes = new Set<PaneId>();
/** Running panes whose output went quiet ≥ QUIET_MS — the agent inside the
 *  command finished a turn / is waiting; the dot has taken over. Cleared
 *  when output resumes (self-correcting) or the command ends. */
const quietWhileRunning = new Set<PaneId>();
/** Quiet timers, keyed by pane. */
const quietTimers = new Map<PaneId, number>();
/** noteOutput throttle stamps. */
const lastNoteAt = new Map<PaneId, number>();
/** When each session last went from visible to hidden. */
const backgroundedAt = new Map<SessionId, number>();
/** Per-pane "ignore output until" stamps (resize repaint noise). */
const mutedUntil = new Map<PaneId, number>();
/** First-note-of-a-possible-stream stamps (see SUSTAIN_MS). */
const streamCandidateAt = new Map<PaneId, number>();

// pane → owning session cache. Any sessions-slice change invalidates it
// (layout edits are rare next to PTY chunks, so this trades a cheap clear
// for not tree-walking every session on every output chunk).
const paneSessionCache = new Map<PaneId, SessionId | null>();

function clearSessionActivity(sid: SessionId, state = useSessionsStore.getState()): void {
  const sess = state.sessions[sid];
  if (sess?.layoutRoot) {
    for (const paneId of treeLeaves(sess.layoutRoot)) {
      clearQuietTimer(paneId);
      streamingPanes.delete(paneId);
      quietWhileRunning.delete(paneId);
      streamCandidateAt.delete(paneId);
    }
  }
  recomputeWorking(sid);
}

useSessionsStore.subscribe((state, prev) => {
  if (state.sessions !== prev.sessions) paneSessionCache.clear();
  const prevVisible = getVisibleSessionIds(prev);
  const nextVisible = getVisibleSessionIds(state);
  const nextVisibleSet = new Set(nextVisible);
  const visibilityChanged =
    prevVisible.length !== nextVisible.length || prevVisible.some((sid) => !nextVisibleSet.has(sid));
  if (visibilityChanged) {
    // View transition. Sessions that just left the screen get a clean slate:
    // every signal the user could have seen while they were visible is
    // acknowledged by having been visible. Only what happens after that should
    // light them up. The grace stamp swallows repaint noise from the switch.
    const now = Date.now();
    for (const sid of prevVisible) {
      if (nextVisibleSet.has(sid)) continue;
      backgroundedAt.set(sid, now);
      clearSessionActivity(sid, state);
    }
    for (const sid of nextVisible) backgroundedAt.delete(sid);
  }
});

function sessionIdFor(paneId: PaneId): SessionId | null {
  if (paneSessionCache.has(paneId)) return paneSessionCache.get(paneId)!;
  const session = findSessionForPane(useSessionsStore.getState(), paneId);
  const sid = session?.id ?? null;
  paneSessionCache.set(paneId, sid);
  return sid;
}

// ---------------------------------------------------------------------------
// Session-level derivation
// ---------------------------------------------------------------------------

/** working(session) = OR over its panes of (running ∨ streaming). Called on
 *  transitions only — never per output chunk for an already-working pane. */
function recomputeWorking(sid: SessionId): void {
  const state = useSessionsStore.getState();
  const session = state.sessions[sid];
  if (!session) return;
  let working = false;
  if (session.layoutRoot) {
    for (const paneId of treeLeaves(session.layoutRoot)) {
      if (streamingPanes.has(paneId)) {
        working = true;
        break;
      }
    }
  }
  if (session.working !== working) state.setWorking(sid, working);
}

function clearQuietTimer(paneId: PaneId): void {
  const t = quietTimers.get(paneId);
  if (t !== undefined) {
    window.clearTimeout(t);
    quietTimers.delete(paneId);
  }
}

/** (Re)arm the pane's quiet timer. On expiry, what quiet MEANS depends on the
 *  pane's command state at that moment (it may have changed since arming). */
function armQuietTimer(paneId: PaneId, sid: SessionId): void {
  clearQuietTimer(paneId);
  quietTimers.set(
    paneId,
    window.setTimeout(() => {
      quietTimers.delete(paneId);
      const stateNow = paneCommandState(paneId);
      streamingPanes.delete(paneId); // quiet = not streaming, in every state
      recomputeWorking(sid);
      if (stateNow === "running") {
        // Turn finished / waiting for input inside a running command.
        quietWhileRunning.add(paneId);
        useSessionsStore.getState().bumpUnread(sid);
      } else if (stateNow === "none") {
        // Fallback: quiet after activity = best "finished a turn" guess.
        useSessionsStore.getState().bumpUnread(sid);
      }
      // "prompt": D already handled the dot — just stop the spinner.
    }, QUIET_MS)
  );
}

// ---------------------------------------------------------------------------
// Signal #1 — OSC 133 ground truth (subscribed once at module load)
// ---------------------------------------------------------------------------

onCommandEvent((evt) => {
  const sid = sessionIdFor(evt.paneId);
  if (!sid) return;
  const store = useSessionsStore.getState();
  switch (evt.type) {
    case "integrated": {
      // The shell just proved it speaks 133 — retire the cadence fallback
      // for this pane so a pending quiet-timer can't fire a guessed dot.
      clearQuietTimer(evt.paneId);
      streamingPanes.delete(evt.paneId);
      recomputeWorking(sid);
      break;
    }
    case "command-start": {
      quietWhileRunning.delete(evt.paneId);
      // Fresh activity — a stale dot no longer reflects reality.
      if (store.sessions[sid]?.unread) store.clearUnread(sid);
      // A starting command IS activity: spinner on now, and if it then sits
      // silent (rare) the timer decays it like any other quiet.
      streamingPanes.add(evt.paneId);
      recomputeWorking(sid);
      armQuietTimer(evt.paneId, sid);
      break;
    }
    case "command-finished": {
      quietWhileRunning.delete(evt.paneId);
      // The spinner should stop at the exact D mark, not a decay later.
      clearQuietTimer(evt.paneId);
      streamingPanes.delete(evt.paneId);
      recomputeWorking(sid);
      // Exact "finished" → dot if this session is in the background.
      // (bumpUnread no-ops for the active session.)
      store.bumpUnread(sid);
      break;
    }
  }
});

// ---------------------------------------------------------------------------
// Signal #2 — explicit agent cues
// ---------------------------------------------------------------------------

/** BEL from xterm. Agents ring it when they finish a turn or block on input —
 *  instant dot, even while a command is still running. */
export function noteBell(paneId: PaneId): void {
  const sid = sessionIdFor(paneId);
  if (!sid) return;
  clearQuietTimer(paneId);
  useSessionsStore.getState().bumpUnread(sid);
}

/** OSC 9 / 99 / 777 desktop-notification conventions — same meaning as BEL. */
export function noteAgentNotification(paneId: PaneId): void {
  noteBell(paneId);
}

// ---------------------------------------------------------------------------
// Signal #3 — output-cadence fallback (non-integrated panes only)
// ---------------------------------------------------------------------------

/** Ignore a pane's output for a moment — called around fit/resize, whose PTY
 *  resize makes full-screen apps repaint. Repaints aren't activity. */
export function muteOutput(paneId: PaneId, ms: number = RESIZE_MUTE_MS): void {
  mutedUntil.set(paneId, Date.now() + ms);
}

export function noteOutput(paneId: PaneId): void {
  const now = Date.now();

  // Noise filters first (before the throttle stamp, so the first REAL chunk
  // after a mute isn't accidentally throttled away):
  //   1. Pane muted around a resize — repaint bytes, not activity.
  //   2. Session just went background — leaving a session makes its
  //      terminals repaint (focus-out redraws); echoes of the switch itself
  //      must not light up the session you just deliberately left.
  const muted = mutedUntil.get(paneId);
  if (muted !== undefined) {
    if (now < muted) return;
    mutedUntil.delete(paneId);
  }
  const sid = sessionIdFor(paneId);
  if (!sid) return;
  const bgAt = backgroundedAt.get(sid);
  if (bgAt !== undefined && now - bgAt < BACKGROUND_GRACE_MS) return;

  const prev = lastNoteAt.get(paneId);
  if (prev !== undefined && now - prev < OUTPUT_THROTTLE_MS) return;
  lastNoteAt.set(paneId, now);

  const store = useSessionsStore.getState();

  // What output MEANS depends on the pane's command state:
  //
  //   "prompt"  → integrated pane idle at its prompt. Output here is noise —
  //               prompt repaints, typing echo. Ignore: no spinner, no dot.
  //   "running" → an agent/command is executing (e.g. `claude`). Output =
  //               actively working (spinner); quiet ≥ QUIET_MS = it finished
  //               a turn or blocked on input → dot. Turn-level detection,
  //               scoped so an idle shell can never false-positive.
  //   "none"    → no integration (cmd/WSL). Plain cadence: streaming =
  //               spinner, quiet = dot. Best signal available.
  const cmdState = paneCommandState(paneId);
  if (cmdState === "prompt") return;

  // Sustained-stream gate: a pane that isn't already streaming needs TWO
  // notes within SUSTAIN_MS to count as working. An isolated chunk (idle TUI
  // repaint) does nothing — no spinner, and it does NOT clear a turn-dot.
  if (!streamingPanes.has(paneId)) {
    const candidate = streamCandidateAt.get(paneId);
    if (candidate === undefined || now - candidate > SUSTAIN_MS) {
      streamCandidateAt.set(paneId, now);
      return;
    }
    streamCandidateAt.delete(paneId);
  }

  if (cmdState === "running") {
    // Output (re)started mid-command: the agent is working. A stale
    // turn-dot no longer applies.
    if (quietWhileRunning.has(paneId)) {
      quietWhileRunning.delete(paneId);
      if (store.sessions[sid]?.unread) store.clearUnread(sid);
    }
  } else {
    // Fallback pane: fresh output self-corrects a stale dot.
    if (store.sessions[sid]?.unread) store.clearUnread(sid);
  }

  if (!streamingPanes.has(paneId)) {
    streamingPanes.add(paneId);
    recomputeWorking(sid);
  }
  armQuietTimer(paneId, sid);
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/** Pane killed — drop every per-pane trace and refresh the session signal. */
export function forgetPane(paneId: PaneId): void {
  const sid = sessionIdFor(paneId);
  clearQuietTimer(paneId);
  quietWhileRunning.delete(paneId);
  streamingPanes.delete(paneId);
  lastNoteAt.delete(paneId);
  mutedUntil.delete(paneId);
  streamCandidateAt.delete(paneId);
  paneSessionCache.delete(paneId);
  forgetPaneCommandState(paneId);
  if (sid) recomputeWorking(sid);
}

/** Clear all pending timers + state (HMR / tests). */
export function disposeAttentionTracker(): void {
  for (const t of quietTimers.values()) window.clearTimeout(t);
  quietTimers.clear();
  quietWhileRunning.clear();
  streamingPanes.clear();
  lastNoteAt.clear();
  mutedUntil.clear();
  streamCandidateAt.clear();
  backgroundedAt.clear();
  paneSessionCache.clear();
}

/** Re-export for tests that drive the 133 path through the public surface. */
export { paneCommandState };
