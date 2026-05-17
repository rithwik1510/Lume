// Per-key leading-edge throttle. Per DESIGN.md §4 rule #4:
//   "High-frequency metadata updates throttled to 200ms per pane.
//    lastActivity updated at most 5x/second."
//
// Each key (typically a paneId) has its own last-emit clock.
// shouldEmit(k, now) returns true on the first call and after the window
// elapses; false in between. Internally records the emit time on success.

export interface Throttle {
  /** Returns true if a call for `key` should fire now, false if throttled. */
  shouldEmit(key: string, now?: number): boolean;
  /** Clear the last-emit time for one key, or all if no key given. */
  reset(key?: string): void;
}

export function createThrottle(windowMs: number): Throttle {
  if (windowMs < 0) throw new Error("windowMs must be >= 0");
  const lastEmit = new Map<string, number>();

  return {
    shouldEmit(key: string, now: number = Date.now()): boolean {
      const last = lastEmit.get(key);
      if (last === undefined || now - last >= windowMs) {
        lastEmit.set(key, now);
        return true;
      }
      return false;
    },
    reset(key?: string): void {
      if (key === undefined) lastEmit.clear();
      else lastEmit.delete(key);
    },
  };
}
