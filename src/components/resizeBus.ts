// Module-level resize bus.
//
// Why this exists (root cause established via systematic debugging):
//   xterm.js's WebGL renderer resizes its <canvas> elements on every
//   term.resize() call. Setting canvas.width or canvas.height on a
//   WebGL canvas CLEARS its framebuffer — that's the WebGL spec, not
//   a renderer bug. Doing this 60 times per second during a splitter
//   drag produces a visible "refresh" of all on-screen text each frame.
//   No amount of CSS containment fixes it because the clear is inside
//   the canvas, not in CSS sampling.
//
// The correct architecture: hide xterm visually during the drag (so the
// per-frame clear-and-redraw isn't visible), then fit + resize exactly
// once on drag-end. This is the same pattern VSCode, Figma, Sketch use
// for heavy canvas content during pane resize.
//
// This file is the imperative bus that PaneTree's PanelResizeHandle uses
// to signal drag start/end to all TerminalPanes simultaneously. A module-
// level counter lets nested splits compose correctly (e.g. if multiple
// drag sessions are conceptually active, the body class stays set until
// all of them have ended).

const BODY_CLASS = "workstation-resizing";

let dragRefCount = 0;
const resizeEndListeners = new Set<() => void>();

function applyBodyClass(): void {
  if (typeof document === "undefined") return;
  if (dragRefCount > 0) {
    document.body.classList.add(BODY_CLASS);
  } else {
    document.body.classList.remove(BODY_CLASS);
  }
}

/**
 * Increment the drag refcount. PanelResizeHandle calls this when its
 * onDragging fires with true. Body class goes on.
 */
export function beginResize(): void {
  dragRefCount += 1;
  applyBodyClass();
}

/**
 * Decrement the drag refcount. PanelResizeHandle calls this when its
 * onDragging fires with false. Body class comes off if no other drags
 * are active. ALL TerminalPanes that subscribed get pinged so they can
 * fit + resize-pty in the same frame the content becomes visible again.
 */
export function endResize(): void {
  dragRefCount = Math.max(0, dragRefCount - 1);
  applyBodyClass();
  if (dragRefCount === 0) {
    for (const listener of resizeEndListeners) {
      try {
        listener();
      } catch {
        // ignore — one listener's failure shouldn't block others
      }
    }
  }
}

/**
 * Subscribe to "all drags have ended" events. Returns an unsubscriber.
 * Used by TerminalPane to know when to fit + send SIGWINCH.
 */
export function onResizeEnd(listener: () => void): () => void {
  resizeEndListeners.add(listener);
  return () => {
    resizeEndListeners.delete(listener);
  };
}

/** Read-only — useful for tests / debug overlays. */
export function isResizing(): boolean {
  return dragRefCount > 0;
}
