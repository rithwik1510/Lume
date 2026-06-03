// src/hooks/useExternalFileDrop.ts
//
// Bridges OS file drops (drag from Windows Explorer) into the terminal-attach
// primitive. Tauri v2 intercepts native file drops (dragDropEnabled defaults
// true) and emits position + absolute paths via onDragDropEvent — the webview
// never sees an HTML5 drop for OS files, so this is the only path for them.
//
// The event position is PHYSICAL pixels; elementFromPoint wants CSS pixels, so
// we divide by devicePixelRatio. We hit-test against [data-pane-id] (set on the
// TerminalPane wrapper in Phase 1) to find the target pane.
//
// Multi-file is deferred: we attach the FIRST path and toast if more were
// dropped, so nothing is silently lost.

import { useEffect } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";

import { useDropTargetStore } from "@/store/dropTargetStore";
import { pasteFileToPane } from "@/lib/pasteFileToPane";
import { useToastStore } from "@/store/toastStore";
import type { PaneId } from "@/types";

function paneIdAtPhysical(x: number, y: number): PaneId | null {
  const dpr = window.devicePixelRatio || 1;
  const el = document.elementFromPoint(x / dpr, y / dpr);
  const host = (el?.closest("[data-pane-id]") as HTMLElement | null) ?? null;
  return (host?.dataset.paneId as PaneId | undefined) ?? null;
}

export function useExternalFileDrop(): void {
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;

    void getCurrentWebview()
      .onDragDropEvent((event) => {
        const p = event.payload;
        if (p.type === "over") {
          useDropTargetStore.getState().setDropTarget(paneIdAtPhysical(p.position.x, p.position.y));
          return;
        }
        if (p.type === "drop") {
          const paneId = paneIdAtPhysical(p.position.x, p.position.y);
          useDropTargetStore.getState().setDropTarget(null);
          if (!paneId || p.paths.length === 0) return;
          pasteFileToPane(paneId, p.paths[0]);
          if (p.paths.length > 1) {
            useToastStore.getState().push({
              severity: "info",
              message: `Attached the first of ${p.paths.length} files (multi-file drop isn't supported yet).`,
            });
          }
          return;
        }
        // "leave" (and any other) — clear the highlight.
        useDropTargetStore.getState().setDropTarget(null);
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      });

    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, []);
}
