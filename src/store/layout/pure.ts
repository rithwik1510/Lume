// Pure (Immer-draft style) reducers for the v0.1 Weekend-1 layout: a flat
// ordered list of PaneIds + a focus pointer. Tree-based tiling lands in
// Weekend 2; until then keep this dumb so smoothness validation doesn't
// couple to layout decisions.
//
// These functions mutate an Immer draft. Tests apply them via `produce`.

import type { Draft } from "immer";
import type { LayoutState, PaneId } from "@/types";

/** The initial state at app load — no panes, no focus. */
export function emptyLayout(): LayoutState {
  return { paneIds: [], focusedPaneId: null };
}

/** Append a pane and focus it. Idempotent: re-adding the same paneId is a no-op. */
export function addPane(draft: Draft<LayoutState>, paneId: PaneId): void {
  if (draft.paneIds.includes(paneId)) return;
  draft.paneIds.push(paneId);
  draft.focusedPaneId = paneId;
}

/**
 * Remove a pane by id. If the removed pane was focused, focus shifts to the
 * pane that was previously at index (removed - 1), or to the new index-0 if
 * the removed was at index 0, or to null if the layout is now empty.
 */
export function removePane(draft: Draft<LayoutState>, paneId: PaneId): void {
  const idx = draft.paneIds.indexOf(paneId);
  if (idx === -1) return;
  draft.paneIds.splice(idx, 1);
  if (draft.focusedPaneId === paneId) {
    if (draft.paneIds.length === 0) {
      draft.focusedPaneId = null;
    } else {
      const newIdx = Math.max(0, idx - 1);
      draft.focusedPaneId = draft.paneIds[newIdx] ?? null;
    }
  }
}

/** Set focus to paneId iff it exists in the layout. Otherwise no-op. */
export function focusPane(draft: Draft<LayoutState>, paneId: PaneId): void {
  if (draft.paneIds.includes(paneId)) {
    draft.focusedPaneId = paneId;
  }
}

/**
 * Move focus one step in the given direction along the flat list.
 * "next" → index + 1, "prev" → index - 1. Wraps. No-op on empty list.
 */
export function moveFocus(draft: Draft<LayoutState>, dir: "next" | "prev"): void {
  if (draft.paneIds.length === 0) {
    draft.focusedPaneId = null;
    return;
  }
  const cur = draft.focusedPaneId;
  const i = cur === null ? -1 : draft.paneIds.indexOf(cur);
  const len = draft.paneIds.length;
  const next = dir === "next" ? (i + 1 + len) % len : (i - 1 + len) % len;
  draft.focusedPaneId = draft.paneIds[next] ?? null;
}
