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

    // Resize follows the host element. During a splitter drag the observer
    // fires ~60 times/sec. Calling fit() on each tick triggers a real
    // term.resize() (xterm reflows whenever the cell grid changes), and the
    // accumulating reflows ARE the flicker.
    //
    // Strategy: do NOT call fit() during the drag. Debounce it to 120 ms
    // after the last resize event. The visible Panel area still tracks the
    // drag smoothly (CSS handles that); xterm content gets clipped/expanded
    // by the parent until the drag settles, then one clean reflow at the
    // end. resizePty is debounced from the same timer so it only fires once.
    //
    // 120 ms is a touch longer than 100 ms because react-resizable-panels
    // emits a final onLayout shortly after mouseup; we want our debounce to
    // outlive that final settle.
    let resizeTimer: number | null = null;
    const onResize = () => {
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        resizeTimer = null;
        const dims = fitTerminal(paneId);
        if (!dims) return;
        void resizePty(paneId, dims.cols, dims.rows).catch(() => undefined);
      }, 120);
    };
    const obs = new ResizeObserver(onResize);
    obs.observe(hostRef.current);

    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      obs.disconnect();
      if (resizeTimer !== null) window.clearTimeout(resizeTimer);
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
