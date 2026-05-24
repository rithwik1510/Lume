// TerminalPane — React component that ATTACHES a registered Terminal to a DOM
// host. It does NOT own the Terminal; the registry does. Lifecycle:
//   - mount: attach
//   - unmount: detach (Terminal stays alive in the registry)
//   - actual disposal happens when the PTY orchestrator decides
//
// React.memo'd because re-renders should be cheap (no per-byte work happens
// here — bytes flow Channel → registry.writeToTerminal directly).

import { memo, useEffect, useRef, type MouseEvent as ReactMouseEvent } from "react";

import { onResizeEnd, isResizing } from "@/components/resizeBus";
import {
  attach,
  detach,
  fitTerminal,
  focusTerminal,
  resetMouseModes,
} from "@/terminals/registry";
import { resizePty } from "@/terminals/ptyClient";
import { changeShell, getDetectedShells } from "@/terminals/orchestrator";
import { useContextMenuStore } from "@/store/contextMenuStore";
import { useLayoutStore } from "@/store/layoutStore";
import { shellLabel } from "@/lib/shellsClient";
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

    // Resize handling — see resizeBus.ts header for the root cause.
    //
    // During a splitter drag we deliberately do NOT call fit(). xterm.js's
    // WebGL renderer writes canvas.width / canvas.height inside its
    // handleResize() (verified against @xterm/addon-webgl/src/WebglRenderer.ts),
    // and writing to a WebGL canvas's pixel dimensions clears its framebuffer
    // per the WebGL spec. Doing that 60 times per second is the flicker.
    // Skipping fit() during the drag keeps the canvas dimensions stable, so
    // no clear, so no flicker. xterm content stays at its old pixel size
    // while the wrapper grows / shrinks around it — content is still visible
    // and the brief mismatch is the same pattern VSCode / JetBrains / Warp use.
    //
    // Two triggers fire fit() + PTY resize:
    //   1. ResizeObserver — handles non-drag size changes (window resize,
    //      manual layout changes). Debounced to 50 ms; if isResizing() is
    //      true the callback bails because the drag-end path will handle it.
    //   2. onResizeEnd subscription — fires exactly once at drag-end. Runs
    //      fit + resizePty immediately so content snaps into place the
    //      moment the user releases the mouse.
    let debounceTimer: number | null = null;
    const runFitAndResize = () => {
      const dims = fitTerminal(paneId);
      if (!dims) return;
      void resizePty(paneId, dims.cols, dims.rows).catch(() => undefined);
    };
    const onResize = () => {
      if (isResizing()) return; // drag-end will handle it
      if (debounceTimer !== null) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => {
        debounceTimer = null;
        runFitAndResize();
      }, 50);
    };
    const obs = new ResizeObserver(onResize);
    obs.observe(hostRef.current);
    const unsubResizeEnd = onResizeEnd(runFitAndResize);

    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      obs.disconnect();
      unsubResizeEnd();
      if (debounceTimer !== null) window.clearTimeout(debounceTimer);
      detach(paneId);
    };
  }, [paneId]);

  // Click to focus this pane (UX expectation in any terminal multiplexer).
  const onMouseDown = () => {
    useLayoutStore.getState().focusPane(paneId);
    focusTerminal(paneId);
  };

  // Right-click → context menu with a "Change Shell…" submenu listing every
  // shell detected at boot (DESIGN.md §12 W3 #8-#9). The submenu is empty
  // until `detectShells` resolves; harmless — user just gets an empty submenu.
  const onContextMenu = (e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const shells = getDetectedShells();
    const submenu = shells.map((s) => ({
      label: shellLabel(s),
      onClick: () => void changeShell(paneId, s),
    }));
    useContextMenuStore.getState().openMenu(e.clientX, e.clientY, [
      { label: "Change Shell…", submenu },
    ]);
  };

  return (
    <div
      onMouseDown={onMouseDown}
      onContextMenu={onContextMenu}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        padding: 6,
        background: "var(--bg-0)",
        boxSizing: "border-box",
      }}
    >
      <div ref={hostRef} style={{ width: "100%", height: "100%" }} />
    </div>
  );
}

export const TerminalPane = memo(TerminalPaneImpl);
