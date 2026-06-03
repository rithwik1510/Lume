// src/lib/internalFileDrag.ts
//
// Pointer-based drag for attaching a file from the in-app file tree to a
// terminal pane. We deliberately do NOT use HTML5 drag-and-drop here: Tauri's
// window `dragDropEnabled` defaults to true (and must stay true for the external
// OS-Explorer drop), and on WebView2 that OS-level file-drop handler suppresses
// the webview's own HTML5 dragover/drop events — so a `draggable` element + DOM
// drop handlers silently never fire. A manual mousedown→mousemove→mouseup drag
// sidesteps the OS layer entirely and works regardless of `dragDropEnabled`.
//
// A real drag only begins once the pointer moves past DRAG_THRESHOLD_PX, so a
// plain click still falls through to the row's onClick (open Quick Viewer).

import { useDropTargetStore } from "@/store/dropTargetStore";
import { pasteFileToPane } from "@/lib/pasteFileToPane";
import { paneIdAtClientPoint } from "@/lib/paneHitTest";

const DRAG_THRESHOLD_PX = 5;

function basename(p: string): string {
  return p.split(/[/\\]/).pop() ?? p;
}

/** A small label that follows the cursor so the drag is visible. */
function makeGhost(label: string): HTMLDivElement {
  const g = document.createElement("div");
  g.textContent = label;
  g.style.cssText = [
    "position:fixed",
    "left:0",
    "top:0",
    "z-index:1000",
    "pointer-events:none",
    "padding:2px 8px",
    "border-radius:var(--radius-sm,4px)",
    "font:12px var(--font-ui,sans-serif)",
    "background:var(--bg-2,#222)",
    "color:var(--fg-0,#eee)",
    "border:1px solid var(--accent,#e0a44a)",
    "box-shadow:0 2px 8px rgba(0,0,0,.4)",
    "transform:translate(10px,10px)",
  ].join(";");
  document.body.appendChild(g);
  return g;
}

/** Start a pointer-drag of `filePath` from the file tree. Call from a file
 *  row's onMouseDown with the pointer's starting client coordinates. */
export function beginInternalFileDrag(filePath: string, startX: number, startY: number): void {
  let dragging = false;
  let ghost: HTMLDivElement | null = null;

  const onMove = (e: MouseEvent) => {
    if (!dragging) {
      if (Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD_PX) return;
      dragging = true;
      ghost = makeGhost(basename(filePath));
    }
    e.preventDefault(); // suppress text selection while dragging
    if (ghost) {
      ghost.style.left = `${e.clientX}px`;
      ghost.style.top = `${e.clientY}px`;
    }
    useDropTargetStore.getState().setDropTarget(paneIdAtClientPoint(e.clientX, e.clientY));
  };

  const onUp = (e: MouseEvent) => {
    const wasDragging = dragging;
    const paneId = wasDragging ? paneIdAtClientPoint(e.clientX, e.clientY) : null;
    window.removeEventListener("mousemove", onMove, true);
    window.removeEventListener("mouseup", onUp, true);
    if (ghost) {
      ghost.remove();
      ghost = null;
    }
    useDropTargetStore.getState().setDropTarget(null);
    if (!wasDragging) return; // a plain click — let the row's onClick run
    if (paneId) pasteFileToPane(paneId, filePath);
    // Swallow the click that follows this mouseup so the row's onClick
    // (open Quick Viewer) doesn't also fire after a drag.
    const swallowClick = (ev: MouseEvent) => {
      ev.stopPropagation();
      ev.preventDefault();
      window.removeEventListener("click", swallowClick, true);
    };
    window.addEventListener("click", swallowClick, true);
  };

  window.addEventListener("mousemove", onMove, true);
  window.addEventListener("mouseup", onUp, true);
}
