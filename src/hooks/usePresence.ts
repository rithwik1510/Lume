// usePresence — keeps a component mounted through its exit animation.
//
// Most overlays/drawers in the app conditionally mount (`return null` when
// closed), so they can animate IN but vanish instantly on close. This hook
// holds the node mounted while it plays an exit transition, then unmounts.
//
// Returns { mounted, state }:
//   - mounted: whether to render at all
//   - state: "open" | "closed" — drive CSS via a data-state attribute and
//     transition between the open/closed styles.
//
// Lifecycle:
//   open=true  → mounted=true; state starts "closed" then flips to "open" on
//                the next frame so the enter transition runs from the closed
//                styles (the first commit is "closed", the next is "open").
//   open=false → state flips to "closed" (exit transition runs); after exitMs
//                the node unmounts (mounted=false).
//
// Honours prefers-reduced-motion: state/mounted follow `open` synchronously
// with no enter/exit delay. Initial mount does NOT animate (a component that
// renders already-open just appears) — only genuine open/close transitions do.

import { useEffect, useRef, useState } from "react";

/** Matches --dur-fast (the default exit duration). */
const DEFAULT_EXIT_MS = 120;

export interface PresenceState {
  mounted: boolean;
  state: "open" | "closed";
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function usePresence(open: boolean, exitMs: number = DEFAULT_EXIT_MS): PresenceState {
  const [mounted, setMounted] = useState(open);
  const [state, setState] = useState<"open" | "closed">(open ? "open" : "closed");

  const firstRun = useRef(true);
  const exitTimer = useRef<number | null>(null);
  const rafId = useRef<number | null>(null);

  useEffect(() => {
    const clearExit = () => {
      if (exitTimer.current !== null) {
        window.clearTimeout(exitTimer.current);
        exitTimer.current = null;
      }
    };
    const clearRaf = () => {
      if (rafId.current !== null) {
        cancelAnimationFrame(rafId.current);
        rafId.current = null;
      }
    };

    // First run: initialise to match `open` with no animation. The useState
    // initialisers already did this; just consume the first run so subsequent
    // changes animate.
    if (firstRun.current) {
      firstRun.current = false;
      return;
    }

    if (prefersReducedMotion()) {
      clearExit();
      clearRaf();
      setMounted(open);
      setState(open ? "open" : "closed");
      return;
    }

    if (open) {
      clearExit();
      setMounted(true);
      // Render once as "closed", then flip to "open" so the transition runs
      // from the closed styles. Double rAF guarantees the closed frame is
      // committed by the compositor before we change to open.
      setState("closed");
      clearRaf();
      rafId.current = requestAnimationFrame(() => {
        rafId.current = requestAnimationFrame(() => {
          rafId.current = null;
          setState("open");
        });
      });
    } else {
      clearRaf();
      setState("closed");
      clearExit();
      exitTimer.current = window.setTimeout(() => {
        exitTimer.current = null;
        setMounted(false);
      }, exitMs);
    }

    return () => {
      clearRaf();
    };
  }, [open, exitMs]);

  // Final cleanup on unmount.
  useEffect(
    () => () => {
      if (exitTimer.current !== null) window.clearTimeout(exitTimer.current);
      if (rafId.current !== null) cancelAnimationFrame(rafId.current);
    },
    []
  );

  return { mounted, state };
}
