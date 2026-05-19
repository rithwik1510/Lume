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

    // Resize follows the host element. ResizeObserver is cheaper than
    // window 'resize' for per-pane fits when splitters move (Weekend 2).
    const obs = new ResizeObserver(() => {
      const dims = fitTerminal(paneId);
      if (dims) {
        // Fire-and-forget; ignore errors when PTY isn't ready yet.
        void resizePty(paneId, dims.cols, dims.rows).catch(() => undefined);
      }
    });
    obs.observe(hostRef.current);

    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      obs.disconnect();
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
