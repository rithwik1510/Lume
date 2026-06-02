// Attention tracker — drives the tri-state attention dot in the session
// sidebar, so when you're running agents (Claude Code, Codex, …) across many
// projects you can see at a glance which one is *working* vs *waiting on you*.
//
// Tri-state per background session:
//   working (green pulse)  — output is currently streaming.
//   unread  (amber pulse)  — output happened, then went quiet for IDLE_MS,
//                            i.e. "finished a turn / needs input".
//   off                    — nothing happening (idle shell, or stopped).
//
// Two signals:
//
//   noteBell(paneId)   — the program rang the terminal bell (BEL). Agents and
//                        shells commonly ring it on completion or when they
//                        block for input. Treated as an explicit "needs you"
//                        cue → flips straight to unread.
//
//   noteOutput(paneId) — the pane emitted output. While output is arriving the
//                        session is "working"; if it then goes quiet for
//                        IDLE_MS the agent has likely finished its turn → flip
//                        to unread. Continuous output keeps resetting the
//                        timer, so a still-streaming session doesn't glow
//                        prematurely.
//
// Why this works cleanly: setWorking and bumpUnread both no-op for the active
// (visible) session, and activateSession clears both flags — so the session
// you're looking at never glows, and switching to a glowing session dismisses
// it.

import { useSessionsStore, findSessionForPane } from "@/store/sessionsStore";
import type { PaneId } from "@/types";

/** Quiet-after-output window that counts as "finished a turn". */
const IDLE_MS = 2000;

const idleTimers = new Map<string, number>();
const sawOutput = new Set<string>();

/** Resolve the owning session id, but only if it's a BACKGROUND session
 *  (exists and isn't the currently-visible one). null otherwise. */
function backgroundSessionId(paneId: PaneId): string | null {
  const state = useSessionsStore.getState();
  const session = findSessionForPane(state, paneId);
  if (!session) return null;
  if (session.id === state.activeSessionId) return null; // visible — no cue needed
  return session.id;
}

export function noteOutput(paneId: PaneId): void {
  const sid = backgroundSessionId(paneId);
  if (sid === null) return;
  sawOutput.add(sid);
  // Flip to working (green) immediately on the leading edge — bumpUnread on
  // the previous turn already cleared working, so a new burst of output
  // re-arms the green pulse. setWorking itself is a no-op if the session
  // became active in the meantime.
  useSessionsStore.getState().setWorking(sid, true);
  const prev = idleTimers.get(sid);
  if (prev !== undefined) window.clearTimeout(prev);
  idleTimers.set(
    sid,
    window.setTimeout(() => {
      idleTimers.delete(sid);
      // Only glow if we actually saw output for this turn (set above) and the
      // session is still backgrounded (bumpUnread itself re-checks active).
      // bumpUnread also clears working, so green → amber in one step.
      if (sawOutput.delete(sid)) {
        useSessionsStore.getState().bumpUnread(sid);
      }
    }, IDLE_MS)
  );
}

export function noteBell(paneId: PaneId): void {
  const sid = backgroundSessionId(paneId);
  if (sid === null) return;
  // Bell is an explicit "done / needs you" cue — cancel any pending idle timer
  // so it doesn't re-glow later, and bumpUnread (clears working internally).
  const prev = idleTimers.get(sid);
  if (prev !== undefined) {
    window.clearTimeout(prev);
    idleTimers.delete(sid);
  }
  sawOutput.delete(sid);
  useSessionsStore.getState().bumpUnread(sid);
}

/** Clear all pending idle timers (HMR / teardown). */
export function disposeAttentionTracker(): void {
  for (const t of idleTimers.values()) window.clearTimeout(t);
  idleTimers.clear();
  sawOutput.clear();
}
