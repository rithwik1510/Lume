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
  resumeOne(ids: string[], activeId: string | null): void;
  onPaneReady(cb: (paneId: string) => void): () => void;
  autorunPaneIds(sessionId: string): string[];
}

/**
 * Revive `ids` one session at a time. The focused session (`activeId`, or the
 * first id when stale/absent) is revived synchronously; each further session
 * waits until the PREVIOUS session's autorun panes all reported prompt-ready
 * (a session with no autorun panes is immediately satisfied) OR `timeoutMs`
 * elapsed since the previous revive — whichever first — AND at least `gapMs`
 * elapsed since the previous revive. Every revive keeps focusing the first
 * session so a later revive never steals focus.
 *
 * Returns an idempotent cancel function that clears all timers and disposes
 * the readiness subscription.
 */
export function sequentialResume(
  ids: string[],
  activeId: string | null,
  deps: SequentialResumeDeps,
  timeoutMs: number = SESSION_READY_TIMEOUT_MS,
  gapMs: number = MIN_GAP_MS
): () => void {
  const first = activeId !== null && ids.includes(activeId) ? activeId : ids[0];
  if (first === undefined) return () => {};

  const queue = ids.filter((id) => id !== first);
  let cancelled = false;
  let disposeReady: (() => void) | null = null;
  let gapTimer: ReturnType<typeof setTimeout> | null = null;
  let timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  let index = 0;

  const clearStep = () => {
    if (gapTimer !== null) clearTimeout(gapTimer);
    if (timeoutTimer !== null) clearTimeout(timeoutTimer);
    gapTimer = null;
    timeoutTimer = null;
    disposeReady?.();
    disposeReady = null;
  };

  // Arm the wait for the step AFTER prevId's revive. Advances when both
  // (readiness-or-timeout) and the minimum gap are satisfied.
  const armStep = (prevId: string) => {
    if (cancelled || index >= queue.length) return;

    const pending = new Set(deps.autorunPaneIds(prevId));
    let ready = pending.size === 0;
    let gapDone = false;

    const maybeAdvance = () => {
      if (cancelled || !ready || !gapDone) return;
      clearStep();
      const next = queue[index++];
      // Keep focusing `first`: resumeSessions's focus branch prefers a still-
      // present activeId, so passing `first` (already revived) never lets a
      // later revive steal focus.
      deps.resumeOne([next], first);
      armStep(next);
    };

    if (!ready) {
      disposeReady = deps.onPaneReady((paneId) => {
        if (!pending.delete(paneId)) return;
        if (pending.size === 0) {
          ready = true;
          maybeAdvance();
        }
      });
      timeoutTimer = setTimeout(() => {
        timeoutTimer = null;
        ready = true;
        maybeAdvance();
      }, timeoutMs);
    }
    gapTimer = setTimeout(() => {
      gapTimer = null;
      gapDone = true;
      maybeAdvance();
    }, gapMs);
  };

  deps.resumeOne([first], first);
  armStep(first);

  return () => {
    if (cancelled) return;
    cancelled = true;
    clearStep();
  };
}
