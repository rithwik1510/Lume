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

    // Resize follows the host element. During a splitter drag this fires
    // 60+ times per second, which without coalescing causes xterm to reflow
    // and the PTY to take an IPC round-trip on every frame → visible flicker.
    //
    // Mitigations:
    //   1. fit() coalesced to one call per requestAnimationFrame — visual
    //      reflow runs at most at the display's refresh rate.
    //   2. resizePty() (the IPC round-trip + portable-pty ioctl) debounced
    //      to 100 ms AFTER the last resize event. The PTY only needs the
    //      final size once the user releases the splitter.
    let fitRafId: number | null = null;
    let resizeIpcTimer: number | null = null;
    const onResize = () => {
      if (fitRafId !== null) return;
      fitRafId = requestAnimationFrame(() => {
        fitRafId = null;
        const dims = fitTerminal(paneId);
        if (!dims) return;
        if (resizeIpcTimer !== null) window.clearTimeout(resizeIpcTimer);
        resizeIpcTimer = window.setTimeout(() => {
          resizeIpcTimer = null;
          void resizePty(paneId, dims.cols, dims.rows).catch(() => undefined);
        }, 100);
      });
    };
    const obs = new ResizeObserver(onResize);
    obs.observe(hostRef.current);

    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      obs.disconnect();
      if (fitRafId !== null) cancelAnimationFrame(fitRafId);
      if (resizeIpcTimer !== null) window.clearTimeout(resizeIpcTimer);
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
