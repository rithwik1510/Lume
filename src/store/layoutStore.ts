// layoutStore — Weekend 2 binary tree edition.
//
// State:
//   - root: LayoutNode | null  (null when no panes; the Workstation invariant
//                                "≥1 pane always" is enforced at the action
//                                layer, not in the type)
//   - focusedPaneId: PaneId | null
//
// All tree shape questions live in ./layout/tree.ts. This file is the
// Zustand wrapper + the invariants we can only enforce at the store level
// (e.g. last-pane lock, focus follows splits, focus shifts on close).

import { create } from "zustand";
import { devtools, persist, createJSONStorage } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

import type { PaneId } from "@/types";
import { tauriPersistStorage } from "@/lib/persistStorage";
import {
  type LayoutNode,
  type SplitDirection,
  type FocusDirection,
  leaf,
  leaves,
  contains,
  splitPane as splitPaneOp,
  closePane as closePaneOp,
  resizeSplit as resizeSplitOp,
  moveFocus as moveFocusOp,
  clampRatio,
} from "./layout/tree";

interface LayoutState {
  root: LayoutNode | null;
  focusedPaneId: PaneId | null;
}

interface LayoutActions {
  /**
   * Create the very first pane in an empty layout. Sets focus to that pane.
   * No-op if the layout is already populated — use splitPane for additional panes.
   */
  initWithFirstPane: (paneId: PaneId) => void;

  /**
   * Split the currently-focused pane (or `targetId` if explicit) in the given
   * direction, adding `newPaneId` as the new leaf. Focus moves to the new pane.
   */
  splitPane: (direction: SplitDirection, newPaneId: PaneId, targetId?: PaneId) => void;

  /**
   * Close the leaf for `paneId`. Enforces the last-pane lock: closing the
   * only leaf is a no-op (the caller / UI should disable the close button).
   * Focus shifts to a sensible neighbour leaf.
   */
  closePane: (paneId: PaneId) => void;

  /** Set focus to paneId iff its leaf exists. */
  focusPane: (paneId: PaneId) => void;

  /** Move focus geometrically (left/right/up/down). Wraps. */
  moveFocus: (direction: FocusDirection) => void;

  /**
   * Set the ratio of the split between two ids (typically the two leaves
   * on either side of a splitter being dragged).
   */
  resizeSplit: (a: PaneId, b: PaneId, ratio: number) => void;

  /** Reset to an empty layout. Used by tests; UI-level "new workspace" later. */
  reset: () => void;
}

export type LayoutStore = LayoutState & LayoutActions;

const emptyState = (): LayoutState => ({ root: null, focusedPaneId: null });

/**
 * Pick a sensible neighbour to focus when the focused leaf is being closed.
 * Strategy: the leaf adjacent to the closed one in DFS order, preferring the
 * one BEFORE it (so closing a pane feels like "stepping back" to its origin).
 */
function pickFocusAfterClose(
  newRoot: LayoutNode,
  closedId: PaneId,
  prevAllLeaves: PaneId[]
): PaneId {
  const idx = prevAllLeaves.indexOf(closedId);
  if (idx > 0) {
    const candidate = prevAllLeaves[idx - 1]!;
    if (contains(newRoot, candidate)) return candidate;
  }
  if (idx >= 0 && idx + 1 < prevAllLeaves.length) {
    const candidate = prevAllLeaves[idx + 1]!;
    if (contains(newRoot, candidate)) return candidate;
  }
  // Fallback: first remaining leaf.
  return leaves(newRoot)[0]!;
}

export const useLayoutStore = create<LayoutStore>()(
  devtools(
    persist(
      immer((set) => ({
      ...emptyState(),

      initWithFirstPane: (paneId) =>
        set(
          (d) => {
            if (d.root !== null) return;
            d.root = leaf(paneId);
            d.focusedPaneId = paneId;
          },
          false,
          "layout/initWithFirstPane"
        ),

      splitPane: (direction, newPaneId, targetId) =>
        set(
          (d) => {
            if (d.root === null) {
              // Nothing to split — degenerate to init.
              d.root = leaf(newPaneId);
              d.focusedPaneId = newPaneId;
              return;
            }
            const t = targetId ?? d.focusedPaneId;
            if (t === null) return;
            if (!contains(d.root, t)) return;
            if (contains(d.root, newPaneId)) return; // paneId must be unique
            d.root = splitPaneOp(d.root, t, direction, newPaneId);
            d.focusedPaneId = newPaneId;
          },
          false,
          "layout/splitPane"
        ),

      closePane: (paneId) =>
        set(
          (d) => {
            if (d.root === null) return;
            if (!contains(d.root, paneId)) return;
            const allLeaves = leaves(d.root);
            // Last-pane lock: refuse to close if it would leave 0 leaves.
            if (allLeaves.length <= 1) return;
            const next = closePaneOp(d.root, paneId);
            if (next === null) return; // belt-and-suspenders against the same lock
            d.root = next;
            if (d.focusedPaneId === paneId) {
              d.focusedPaneId = pickFocusAfterClose(next, paneId, allLeaves);
            }
          },
          false,
          "layout/closePane"
        ),

      focusPane: (paneId) =>
        set(
          (d) => {
            if (d.root === null) return;
            if (contains(d.root, paneId)) {
              d.focusedPaneId = paneId;
            }
          },
          false,
          "layout/focusPane"
        ),

      moveFocus: (direction) =>
        set(
          (d) => {
            if (d.root === null || d.focusedPaneId === null) return;
            d.focusedPaneId = moveFocusOp(d.root, d.focusedPaneId, direction);
          },
          false,
          "layout/moveFocus"
        ),

      resizeSplit: (a, b, ratio) =>
        set(
          (d) => {
            if (d.root === null) return;
            d.root = resizeSplitOp(d.root, a, b, clampRatio(ratio));
          },
          false,
          "layout/resizeSplit"
        ),

      reset: () =>
        set(
          (d) => {
            const fresh = emptyState();
            d.root = fresh.root;
            d.focusedPaneId = fresh.focusedPaneId;
          },
          false,
          "layout/reset"
        ),
    })),
      {
        name: "layout",
        storage: createJSONStorage(() => tauriPersistStorage("workstation-store.json")),
        version: 1,
        // Persist the tree shape only. focusedPaneId is intentionally reset
        // on rehydrate — DESIGN.md §4 EXCLUDED list. The orchestrator
        // re-spawns PTYs by reacting to leaves appearing in the layout.
        partialize: (state) => ({ root: state.root }),
        // On hydrate, ensure focusedPaneId points to a valid leaf. If the
        // persisted tree is null or contains no leaves, leave focus null and
        // let App.tsx's bootstrap initialise a fresh pane.
        onRehydrateStorage: () => (state) => {
          if (state && state.root !== null) {
            const ids = getPaneIds(state);
            // Direct mutation (state.focusedPaneId = ...) changes the value
            // but bypasses notifyListeners, so subscribers (e.g. the
            // focused-pane border) wouldn't re-render until the next user
            // interaction. setState dispatches through the store properly.
            useLayoutStore.setState({ focusedPaneId: ids[0] ?? null });
          }
        },
      }
    ),
    { name: "layout", enabled: import.meta.env.DEV }
  )
);

// ---------- Derived selectors ----------

/** All paneIds in the current layout, DFS order. Recomputed on each call. */
export function getPaneIds(state: LayoutState): PaneId[] {
  return state.root === null ? [] : leaves(state.root);
}
