// Workstation keyboard shortcuts (W2-P3 — DESIGN.md §7 + §12 Weekend 2 #3).
//
// We install ONE window-level keydown listener (capture phase) so the
// shortcuts fire before xterm.js consumes the keystroke. Without capture,
// xterm gets first dibs on every key when a Terminal Pane has DOM focus
// and our Ctrl+Alt+→ would land inside the shell instead of triggering a
// split.
//
// Shortcuts (focused-surface-aware will land in Weekend 3 with MD Editor;
// for now everything routes to the layout / terminal store):
//
//   Ctrl+Alt+→           split focused pane right
//   Ctrl+Alt+↓           split focused pane down
//   Ctrl+Alt+↑           split focused pane up
//   Ctrl+→ / ← / ↑ / ↓   move focus geometrically
//   Ctrl+W               close focused pane (last-pane lock holds)

import { useEffect } from "react";

import { useLayoutStore } from "@/store/layoutStore";
import { useMdStore } from "@/store/mdStore";
import type { FocusDirection, SplitDirection } from "@/store/layout/tree";

// ---------- PaneId generator ----------
// Module-level counter so paneIds stay stable across the session. Seeded high
// enough that it never collides with the App.tsx bootstrap ids (pane-1..4).

let paneIdCounter = 100;
function nextPaneId(): string {
  paneIdCounter += 1;
  return `pane-${paneIdCounter}`;
}

// Optional: let the bootstrap reserve ids so the counter starts above them.
export function reservePaneIdsAtLeast(n: number): void {
  if (n > paneIdCounter) paneIdCounter = n;
}

// ---------- Shortcut handler ----------

interface Shortcut {
  match: (e: KeyboardEvent) => boolean;
  /** Returns true if the shortcut was handled (we'll call preventDefault). */
  run: () => boolean;
}

function isCtrlOnly(e: KeyboardEvent): boolean {
  return e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey;
}

function isCtrlAlt(e: KeyboardEvent): boolean {
  return e.ctrlKey && e.altKey && !e.shiftKey && !e.metaKey;
}

function focusedPaneOrNull(): string | null {
  return useLayoutStore.getState().focusedPaneId;
}

function splitFromFocused(direction: SplitDirection): boolean {
  const focused = focusedPaneOrNull();
  if (focused === null) return false;
  const id = nextPaneId();
  useLayoutStore.getState().splitPane(direction, id, focused);
  return true;
}

function moveFocus(direction: FocusDirection): boolean {
  if (focusedPaneOrNull() === null) return false;
  useLayoutStore.getState().moveFocus(direction);
  return true;
}

function closeFocused(): boolean {
  const focused = focusedPaneOrNull();
  if (focused === null) return false;
  useLayoutStore.getState().closePane(focused);
  return true;
}

function toggleQuickViewer(): boolean {
  const qv = useMdStore.getState().quickViewer;
  if (qv.open) {
    useMdStore.getState().closeQuickViewer();
  } else if (qv.path !== null) {
    // Reopen the last file if one was previously loaded; otherwise no-op.
    void useMdStore
      .getState()
      .openMdInQuickViewer(qv.path)
      .catch((err) => console.error("openMdInQuickViewer failed", err));
  }
  return true;
}

const SHORTCUTS: Shortcut[] = [
  // Splits — Ctrl+Alt+arrow
  { match: (e) => isCtrlAlt(e) && e.key === "ArrowRight", run: () => splitFromFocused("right") },
  { match: (e) => isCtrlAlt(e) && e.key === "ArrowDown", run: () => splitFromFocused("down") },
  { match: (e) => isCtrlAlt(e) && e.key === "ArrowUp", run: () => splitFromFocused("up") },

  // Focus moves — Ctrl+arrow
  { match: (e) => isCtrlOnly(e) && e.key === "ArrowRight", run: () => moveFocus("right") },
  { match: (e) => isCtrlOnly(e) && e.key === "ArrowLeft", run: () => moveFocus("left") },
  { match: (e) => isCtrlOnly(e) && e.key === "ArrowUp", run: () => moveFocus("up") },
  { match: (e) => isCtrlOnly(e) && e.key === "ArrowDown", run: () => moveFocus("down") },

  // Toggle MD Quick Viewer — Ctrl+Shift+M (must come before Ctrl+W so the
  // narrower shift-modifier match isn't shadowed).
  {
    match: (e) =>
      e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && (e.key === "M" || e.key === "m"),
    run: () => toggleQuickViewer(),
  },

  // Close — Ctrl+W
  { match: (e) => isCtrlOnly(e) && (e.key === "w" || e.key === "W"), run: () => closeFocused() },
];

export function useKeyboardShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      for (const s of SHORTCUTS) {
        if (s.match(e)) {
          if (s.run()) {
            e.preventDefault();
            e.stopPropagation();
          }
          return;
        }
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);
}
