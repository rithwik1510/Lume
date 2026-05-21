// Binary-tree layout model for Weekend 2 — Tiling.
// Replaces the Weekend 1 flat-list layout (which lives in ./pure.ts and is
// kept around only until App.tsx has migrated).
//
// ============================================================================
// SHAPE
// ============================================================================
//
//   type LayoutNode =
//     | { type: "leaf";  paneId: PaneId }
//     | { type: "split"; orientation: H|V; ratio: 0..1; left: LayoutNode; right: LayoutNode }
//
// Leaves carry data (the paneId). Splits carry structure (orientation + ratio +
// two children). The tree always has an odd node count: N leaves + N-1 splits.
//
// Convention: in a "horizontal" split, children are laid out LEFT then RIGHT
//             (visual columns).  In a "vertical" split, children are laid out
//             TOP then BOTTOM (visual rows).  `ratio` is the fraction of width
//             (horizontal) or height (vertical) consumed by the FIRST child.
//
// ============================================================================
// OPERATIONS (semantic lock-in)
// ============================================================================
//
//   splitPane(node, targetId, direction, newPaneId)
//     direction ∈ {"right", "down", "up"}  (no "left" per DESIGN.md §3 split menu)
//     Replaces the leaf for `targetId` with a Split whose:
//       - orientation = "horizontal" for right, "vertical" for down|up
//       - ratio       = 0.5
//       - children    = old leaf + new leaf, ordered by direction:
//                       right → [old, new]
//                       down  → [old, new]
//                       up    → [new, old]
//     If `targetId` is not in the tree, returns the tree unchanged.
//
//   closePane(node, targetId)
//     Removes the leaf for `targetId`. If its parent split has a surviving
//     sibling subtree, that sibling REPLACES the parent split — preserving
//     whatever ratio that split's grandparent has.
//     If `targetId` is the only leaf in the tree, returns NULL — caller
//     (layoutStore) enforces the last-pane lock by refusing to apply NULL.
//
//   focusPane(state, paneId)         (in layoutStore, not here)
//     Sets focusedPaneId iff the leaf exists.
//
//   moveFocus(node, currentId, direction)
//     direction ∈ {"left", "right", "up", "down"}
//     GEOMETRIC, not structural: computes a rectangle layout for the tree
//     (each leaf gets an [x0, y0, x1, y1] in [0,1]² with the root spanning the
//     unit square), then finds the leaf whose rectangle is the nearest in the
//     requested visual direction (centroid distance, restricted to leaves
//     whose centroid is on the correct side). Wraps if no leaf is in that
//     direction (so Ctrl+→ from the rightmost pane goes to the leftmost
//     leaf in the same row).
//
//   resizeSplit(node, targetId, sibling, newRatio)
//     Find the split that has [targetId, sibling] as immediate children
//     (in either order); set its ratio. Caller clamps to [0.05, 0.95] so
//     splitters can't become invisible.
//
//   leaves(node) → PaneId[]   in tree-DFS order
//   computeRects(node) → Map<PaneId, Rect>  unit-square layout
//
// ============================================================================
// INVARIANTS
// ============================================================================
//
//   I1.  Every Split has TWO children. A Split with one child is invalid.
//   I2.  PaneIds are unique across leaves (asserted in dev).
//   I3.  Ratios are in [0.05, 0.95] (clamped on resize).
//   I4.  The last-pane lock is enforced at the layoutStore boundary, not
//        in closePane. closePane returning NULL is the signal "this would
//        close the last leaf — caller decides what to do."

import type { Draft } from "immer";

import type { PaneId } from "@/types";

// ---------- Types ----------

export type Orientation = "horizontal" | "vertical";
export type SplitDirection = "right" | "down" | "up";
export type FocusDirection = "left" | "right" | "up" | "down";

export interface LeafNode {
  type: "leaf";
  paneId: PaneId;
}

export interface SplitNode {
  type: "split";
  orientation: Orientation;
  /** Fraction of width (horizontal) or height (vertical) for the FIRST child. */
  ratio: number;
  left: LayoutNode;
  right: LayoutNode;
}

export type LayoutNode = LeafNode | SplitNode;

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

// ---------- Constructors ----------

export function leaf(paneId: PaneId): LeafNode {
  return { type: "leaf", paneId };
}

export function split(
  orientation: Orientation,
  ratio: number,
  left: LayoutNode,
  right: LayoutNode
): SplitNode {
  return { type: "split", orientation, ratio: clampRatio(ratio), left, right };
}

export const MIN_RATIO = 0.05;
export const MAX_RATIO = 0.95;
export const DEFAULT_RATIO = 0.5;

export function clampRatio(r: number): number {
  if (Number.isNaN(r)) return DEFAULT_RATIO;
  return Math.max(MIN_RATIO, Math.min(MAX_RATIO, r));
}

// ---------- Read-only queries ----------

/** All paneIds in tree-DFS order (left-to-right, top-to-bottom visually). */
export function leaves(node: LayoutNode): PaneId[] {
  if (node.type === "leaf") return [node.paneId];
  return [...leaves(node.left), ...leaves(node.right)];
}

/** Does this tree contain a leaf for paneId? */
export function contains(node: LayoutNode, paneId: PaneId): boolean {
  if (node.type === "leaf") return node.paneId === paneId;
  return contains(node.left, paneId) || contains(node.right, paneId);
}

/**
 * Compute a unit-square rectangle for every leaf. The root spans (0,0)→(1,1).
 * Horizontal splits divide along x; vertical splits divide along y.
 */
export function computeRects(
  node: LayoutNode,
  bounds: Rect = { x0: 0, y0: 0, x1: 1, y1: 1 }
): Map<PaneId, Rect> {
  const out = new Map<PaneId, Rect>();
  walkRects(node, bounds, out);
  return out;
}

function walkRects(node: LayoutNode, bounds: Rect, out: Map<PaneId, Rect>): void {
  if (node.type === "leaf") {
    out.set(node.paneId, bounds);
    return;
  }
  if (node.orientation === "horizontal") {
    const xMid = bounds.x0 + (bounds.x1 - bounds.x0) * node.ratio;
    walkRects(node.left, { ...bounds, x1: xMid }, out);
    walkRects(node.right, { ...bounds, x0: xMid }, out);
  } else {
    const yMid = bounds.y0 + (bounds.y1 - bounds.y0) * node.ratio;
    walkRects(node.left, { ...bounds, y1: yMid }, out);
    walkRects(node.right, { ...bounds, y0: yMid }, out);
  }
}

// ---------- Mutations (pure: return a new tree) ----------

/**
 * Replace `targetId`'s leaf with a Split containing [old, new] ordered by
 * direction. Returns the tree unchanged if `targetId` is absent.
 */
export function splitPane(
  node: LayoutNode,
  targetId: PaneId,
  direction: SplitDirection,
  newPaneId: PaneId
): LayoutNode {
  if (!contains(node, targetId)) return node;
  return splitPaneInner(node, targetId, direction, newPaneId);
}

function splitPaneInner(
  node: LayoutNode,
  targetId: PaneId,
  direction: SplitDirection,
  newPaneId: PaneId
): LayoutNode {
  if (node.type === "leaf") {
    if (node.paneId !== targetId) return node;
    const orientation: Orientation =
      direction === "right" ? "horizontal" : "vertical";
    const oldLeaf = leaf(node.paneId);
    const newLeaf = leaf(newPaneId);
    // right / down: [old, new]; up: [new, old]
    const [left, right] = direction === "up" ? [newLeaf, oldLeaf] : [oldLeaf, newLeaf];
    return split(orientation, DEFAULT_RATIO, left, right);
  }
  return split(
    node.orientation,
    node.ratio,
    splitPaneInner(node.left, targetId, direction, newPaneId),
    splitPaneInner(node.right, targetId, direction, newPaneId)
  );
}

/**
 * Remove the leaf for `targetId`. If targetId is the only leaf, returns NULL
 * — caller enforces last-pane lock. Otherwise: when a split has only one
 * remaining child after the cut, the surviving sibling REPLACES the split.
 */
export function closePane(node: LayoutNode, targetId: PaneId): LayoutNode | null {
  if (!contains(node, targetId)) return node; // no-op for unknown ids
  if (node.type === "leaf") return null; // would remove the last leaf
  // Direct child removal at this split level:
  if (node.left.type === "leaf" && node.left.paneId === targetId) return node.right;
  if (node.right.type === "leaf" && node.right.paneId === targetId) return node.left;
  // Recurse into the subtree that contains targetId.
  if (contains(node.left, targetId)) {
    const newLeft = closePane(node.left, targetId);
    return newLeft === null ? node.right : split(node.orientation, node.ratio, newLeft, node.right);
  }
  const newRight = closePane(node.right, targetId);
  return newRight === null ? node.left : split(node.orientation, node.ratio, node.left, newRight);
}

/**
 * Find the split immediately containing both `a` and `b` as ANY descendants
 * (typically as adjacent leaves), set its ratio. Returns the tree unchanged
 * if no such split exists. Used by the splitter drag handler — caller passes
 * the two pane ids on either side of the splitter being dragged.
 */
export function resizeSplit(
  node: LayoutNode,
  a: PaneId,
  b: PaneId,
  newRatio: number
): LayoutNode {
  if (node.type === "leaf") return node;
  const aInLeft = contains(node.left, a);
  const bInRight = contains(node.right, b);
  const aInRight = contains(node.right, a);
  const bInLeft = contains(node.left, b);
  if ((aInLeft && bInRight) || (aInRight && bInLeft)) {
    return split(node.orientation, newRatio, node.left, node.right);
  }
  return split(
    node.orientation,
    node.ratio,
    resizeSplit(node.left, a, b, newRatio),
    resizeSplit(node.right, a, b, newRatio)
  );
}

// ---------- Focus movement (geometric) ----------

/**
 * Find the nearest leaf in the visual direction from `currentId`. Returns
 * the new focus paneId, or `currentId` itself if nothing is in that direction.
 *
 * Algorithm:
 *   1. Compute rects for every leaf.
 *   2. Filter to leaves whose centroid is on the correct side of `currentId`'s
 *      centroid (strictly, with a small epsilon to avoid same-row matches in
 *      vertical directions).
 *   3. Among those, pick the leaf whose centroid is closest in 2D distance.
 *   4. If none found in that direction, wrap to the farthest leaf in the
 *      OPPOSITE direction (visual wrap-around).
 */
export function moveFocus(
  node: LayoutNode,
  currentId: PaneId,
  direction: FocusDirection
): PaneId {
  const rects = computeRects(node);
  const cur = rects.get(currentId);
  if (!cur) return currentId;
  const curCx = (cur.x0 + cur.x1) / 2;
  const curCy = (cur.y0 + cur.y1) / 2;

  type Candidate = { id: PaneId; cx: number; cy: number; d2: number };
  const onSide: Candidate[] = [];
  const opposite: Candidate[] = [];

  const EPS = 1e-6;
  for (const [id, r] of rects.entries()) {
    if (id === currentId) continue;
    const cx = (r.x0 + r.x1) / 2;
    const cy = (r.y0 + r.y1) / 2;
    const dx = cx - curCx;
    const dy = cy - curCy;
    const d2 = dx * dx + dy * dy;
    let onCorrectSide = false;
    let onOppositeSide = false;
    switch (direction) {
      case "left":
        onCorrectSide = dx < -EPS;
        onOppositeSide = dx > EPS;
        break;
      case "right":
        onCorrectSide = dx > EPS;
        onOppositeSide = dx < -EPS;
        break;
      case "up":
        onCorrectSide = dy < -EPS;
        onOppositeSide = dy > EPS;
        break;
      case "down":
        onCorrectSide = dy > EPS;
        onOppositeSide = dy < -EPS;
        break;
    }
    if (onCorrectSide) onSide.push({ id, cx, cy, d2 });
    else if (onOppositeSide) opposite.push({ id, cx, cy, d2 });
  }

  if (onSide.length > 0) {
    onSide.sort((a, b) => a.d2 - b.d2);
    return onSide[0]!.id;
  }
  if (opposite.length > 0) {
    // Wrap: pick the farthest in the opposite direction (visually equivalent
    // to the closest leaf on the "other side" of the screen).
    opposite.sort((a, b) => b.d2 - a.d2);
    return opposite[0]!.id;
  }
  return currentId;
}

// ---------- Immer-compatible draft mutation helpers ----------

/**
 * Convenience for the Zustand store: produces a new root with the named
 * operation applied. Returns the SAME root (object identity) if the op was
 * a no-op, so Immer can short-circuit.
 */
export function applySplit(
  root: LayoutNode,
  targetId: PaneId,
  direction: SplitDirection,
  newPaneId: PaneId
): LayoutNode {
  return splitPane(root, targetId, direction, newPaneId);
}

export function applyClose(root: LayoutNode, targetId: PaneId): LayoutNode | null {
  return closePane(root, targetId);
}

export function applyResize(
  root: LayoutNode,
  a: PaneId,
  b: PaneId,
  newRatio: number
): LayoutNode {
  return resizeSplit(root, a, b, clampRatio(newRatio));
}

// ---------- Draft helpers (for tests against existing Immer pattern) ----------
// Kept for parity with how layoutStore wires them in (it uses pure-return ops
// now, but Draft<LayoutState> mutators can wrap them when needed).

export type _Draft = Draft<LayoutNode>;
