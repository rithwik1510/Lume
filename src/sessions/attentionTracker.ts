// Attention tracker — glows a BACKGROUND session's sidebar dot when its
// terminal looks like it finished a turn / needs input, so when you're running
// agents (Claude Code, Codex, …) across several projects you can see at a
// glance which session wants you and switch to it.
//
// Two signals, both routed to sessionsStore.bumpUnread:
//
//   noteBell(paneId)   — the program rang the terminal bell (BEL). Agents and
//                        shells commonly ring it on completion or when they
//                        block for input — a precise, immediate cue.
//
//   noteOutput(paneId) — the pane emitted output. We (re)arm a per-session
//                        idle timer; if the background session then goes quiet
//                        for IDLE_MS the agent has likely finished its turn →
//                        glow. Continuous output keeps resetting the timer, so
//                        a still-streaming session doesn't glow prematurely.
//
// Why this works cleanly: bumpUnread already no-ops for the active (visible)
// session, and activateSession clears unread — so the session you're looking
// at never glows, and switching to a glowing session dismisses it. We only
// arm anything for sessions that aren't the active one.

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
  const prev = idleTimers.get(sid);
  if (prev !== undefined) window.clearTimeout(prev);
  idleTimers.set(
    sid,
    window.setTimeout(() => {
      idleTimers.delete(sid);
      // Only glow if we actually saw output for this turn (set above) and the
      // session is still backgrounded (bumpUnread itself re-checks active).
      if (sawOutput.delete(sid)) {
        useSessionsStore.getState().bumpUnread(sid);
      }
    }, IDLE_MS)
  );
}

export function noteBell(paneId: PaneId): void {
  const sid = backgroundSessionId(paneId);
  if (sid === null) return;
  useSessionsStore.getState().bumpUnread(sid);
}

/** Clear all pending idle timers (HMR / teardown). */
export function disposeAttentionTracker(): void {
  for (const t of idleTimers.values()) window.clearTimeout(t);
  idleTimers.clear();
  sawOutput.clear();
}
