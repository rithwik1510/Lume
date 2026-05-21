// TerminalPane — React component that ATTACHES a registered Terminal to a DOM
// host. It does NOT own the Terminal; the registry does. Lifecycle:
//   - mount: attach
//   - unmount: detach (Terminal stays alive in the registry)
//   - actual disposal happens when the PTY orchestrator decides
//
// React.memo'd because re-renders should be cheap (no per-byte work happens
// here — bytes flow Channel → registry.writeToTerminal directly).

import { memo, useEffect, useRef } from "react";

import {
  attach,
  detach,
  fitTerminal,
  focusTerminal,
  resetMouseModes,
} from "@/terminals/registry";
import { resizePty } from "@/terminals/ptyClient";
import { useLayoutStore } from "@/store/layoutStore";
import type { PaneId } from "@/types";

interface Props {
  paneId: PaneId;
}

function TerminalPaneImpl({ paneId }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;
    attach(paneId, hostRef.current);
    focusTerminal(paneId);

    // Mouse-mode panic key (focused pane). DESIGN.md §7.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === "R" || e.key === "r")) {
        const focused = useLayoutStore.getState().focusedPaneId;
        if (focused !== paneId) return;
        e.preventDefault();
        resetMouseModes(paneId);
      }
    };
    window.addEventListener("keydown", onKeyDown, true);

    // Resize follows the host element. Two-tier handling to balance visual
    // responsiveness against PTY-side stability:
    //
    //  TIER A — visual fit (xterm cell-grid reflow)
    //     Driven by requestAnimationFrame. fit() runs at most once per
    //     animation frame during a drag, so xterm content tracks the new
    //     container size in real time. The CSS containment + pixelated
    //     rules in xterm-overrides.css mitigate the per-frame redraw
    //     shimmer that would otherwise be visible.
    //
    //  TIER B — PTY ioctl (sends SIGWINCH to the shell)
    //     Debounced to 80 ms after the LAST resize event. The shell (and
    //     any TUI inside it, like claude-code or vim) only receives ONE
    //     SIGWINCH per drag — they redraw once, not 60 times. Critical to
    //     avoid the "multiple stacked Claude Code splashes in scrollback"
    //     artifact.
    let fitRaf: number | null = null;
    let ptyDebounce: number | null = null;
    const onResize = () => {
      if (fitRaf === null) {
        fitRaf = requestAnimationFrame(() => {
          fitRaf = null;
          fitTerminal(paneId);
        });
      }
      if (ptyDebounce !== null) window.clearTimeout(ptyDebounce);
      ptyDebounce = window.setTimeout(() => {
        ptyDebounce = null;
        const dims = fitTerminal(paneId);
        if (!dims) return;
        void resizePty(paneId, dims.cols, dims.rows).catch(() => undefined);
      }, 80);
    };
    const obs = new ResizeObserver(onResize);
    obs.observe(hostRef.current);

    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      obs.disconnect();
      if (fitRaf !== null) cancelAnimationFrame(fitRaf);
      if (ptyDebounce !== null) window.clearTimeout(ptyDebounce);
      detach(paneId);
    };
  }, [paneId]);

  // Click to focus this pane (UX expectation in any terminal multiplexer).
  const onMouseDown = () => {
    useLayoutStore.getState().focusPane(paneId);
    focusTerminal(paneId);
  };

  return (
    <div
      onMouseDown={onMouseDown}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        padding: 6,
        background: "#0a0a0a",
        boxSizing: "border-box",
      }}
    >
      <div ref={hostRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}

export const TerminalPane = memo(TerminalPaneImpl);
