import { describe, it, expect } from "vitest";
import {
  leaf,
  split,
  clampRatio,
  DEFAULT_RATIO,
  MIN_RATIO,
  MAX_RATIO,
  leaves,
  contains,
  computeRects,
  splitPane,
  closePane,
  resizeSplit,
  moveFocus,
  type LayoutNode,
} from "./tree";

// ============================================================================
// Constructors + clamp
// ============================================================================

describe("constructors", () => {
  it("leaf carries the paneId", () => {
    expect(leaf("p1")).toEqual({ type: "leaf", paneId: "p1" });
  });

  it("split carries orientation, ratio (clamped), and children", () => {
    const s = split("horizontal", 0.4, leaf("a"), leaf("b"));
    expect(s.type).toBe("split");
    expect(s.orientation).toBe("horizontal");
    expect(s.ratio).toBe(0.4);
    expect(s.left).toEqual(leaf("a"));
    expect(s.right).toEqual(leaf("b"));
  });

  it("split clamps an out-of-range ratio", () => {
    expect(split("horizontal", 0, leaf("a"), leaf("b")).ratio).toBe(MIN_RATIO);
    expect(split("horizontal", 1, leaf("a"), leaf("b")).ratio).toBe(MAX_RATIO);
    expect(split("horizontal", -5, leaf("a"), leaf("b")).ratio).toBe(MIN_RATIO);
    expect(split("horizontal", 99, leaf("a"), leaf("b")).ratio).toBe(MAX_RATIO);
  });
});

describe("clampRatio", () => {
  it("passes values within [MIN, MAX] through unchanged", () => {
    expect(clampRatio(0.5)).toBe(0.5);
    expect(clampRatio(MIN_RATIO)).toBe(MIN_RATIO);
    expect(clampRatio(MAX_RATIO)).toBe(MAX_RATIO);
  });
  it("clamps NaN to DEFAULT_RATIO", () => {
    expect(clampRatio(NaN)).toBe(DEFAULT_RATIO);
  });
  it("clamps below MIN and above MAX", () => {
    expect(clampRatio(-1)).toBe(MIN_RATIO);
    expect(clampRatio(2)).toBe(MAX_RATIO);
  });
});

// ============================================================================
// leaves / contains
// ============================================================================

describe("leaves", () => {
  it("on a single leaf returns one id", () => {
    expect(leaves(leaf("p1"))).toEqual(["p1"]);
  });
  it("on a split returns left-then-right (DFS order)", () => {
    const t = split("horizontal", 0.5, leaf("a"), leaf("b"));
    expect(leaves(t)).toEqual(["a", "b"]);
  });
  it("on a nested tree returns all leaves DFS L→R", () => {
    //         H 0.5
    //        /     \
    //   V 0.5       leaf c
    //   /   \
    // leaf a leaf b
    const t = split(
      "horizontal",
      0.5,
      split("vertical", 0.5, leaf("a"), leaf("b")),
      leaf("c")
    );
    expect(leaves(t)).toEqual(["a", "b", "c"]);
  });
});

describe("contains", () => {
  const t: LayoutNode = split(
    "horizontal",
    0.5,
    split("vertical", 0.5, leaf("a"), leaf("b")),
    leaf("c")
  );
  it("finds existing leaves", () => {
    expect(contains(t, "a")).toBe(true);
    expect(contains(t, "b")).toBe(true);
    expect(contains(t, "c")).toBe(true);
  });
  it("returns false for unknown ids", () => {
    expect(contains(t, "ghost")).toBe(false);
  });
});

// ============================================================================
// computeRects
// ============================================================================

describe("computeRects", () => {
  it("a single leaf occupies the unit square", () => {
    const rects = computeRects(leaf("p1"));
    expect(rects.get("p1")).toEqual({ x0: 0, y0: 0, x1: 1, y1: 1 });
  });

  it("horizontal 50/50 split slices along x", () => {
    const t = split("horizontal", 0.5, leaf("a"), leaf("b"));
    const r = computeRects(t);
    expect(r.get("a")).toEqual({ x0: 0, y0: 0, x1: 0.5, y1: 1 });
    expect(r.get("b")).toEqual({ x0: 0.5, y0: 0, x1: 1, y1: 1 });
  });

  it("vertical 50/50 split slices along y", () => {
    const t = split("vertical", 0.5, leaf("a"), leaf("b"));
    const r = computeRects(t);
    expect(r.get("a")).toEqual({ x0: 0, y0: 0, x1: 1, y1: 0.5 });
    expect(r.get("b")).toEqual({ x0: 0, y0: 0.5, x1: 1, y1: 1 });
  });

  it("honors non-50 ratios", () => {
    const t = split("horizontal", 0.25, leaf("a"), leaf("b"));
    const r = computeRects(t);
    expect(r.get("a")).toEqual({ x0: 0, y0: 0, x1: 0.25, y1: 1 });
    expect(r.get("b")).toEqual({ x0: 0.25, y0: 0, x1: 1, y1: 1 });
  });

  it("nested splits compose correctly (2x2 grid)", () => {
    //  H 0.5
    //  /    \
    // V 0.5  V 0.5
    // / \    / \
    // a b   c d
    const t = split(
      "horizontal",
      0.5,
      split("vertical", 0.5, leaf("a"), leaf("b")),
      split("vertical", 0.5, leaf("c"), leaf("d"))
    );
    const r = computeRects(t);
    expect(r.get("a")).toEqual({ x0: 0, y0: 0, x1: 0.5, y1: 0.5 });
    expect(r.get("b")).toEqual({ x0: 0, y0: 0.5, x1: 0.5, y1: 1 });
    expect(r.get("c")).toEqual({ x0: 0.5, y0: 0, x1: 1, y1: 0.5 });
    expect(r.get("d")).toEqual({ x0: 0.5, y0: 0.5, x1: 1, y1: 1 });
  });
});

// ============================================================================
// splitPane
// ============================================================================

describe("splitPane", () => {
  it('split right of a leaf produces horizontal split with [old, new]', () => {
    const r = splitPane(leaf("a"), "a", "right", "b");
    expect(r).toEqual(split("horizontal", DEFAULT_RATIO, leaf("a"), leaf("b")));
  });

  it('split down of a leaf produces vertical split with [old, new]', () => {
    const r = splitPane(leaf("a"), "a", "down", "b");
    expect(r).toEqual(split("vertical", DEFAULT_RATIO, leaf("a"), leaf("b")));
  });

  it('split up of a leaf produces vertical split with [new, old]', () => {
    const r = splitPane(leaf("a"), "a", "up", "b");
    expect(r).toEqual(split("vertical", DEFAULT_RATIO, leaf("b"), leaf("a")));
  });

  it("recurses into nested trees and only replaces the target leaf", () => {
    //   H
    //  / \
    // a   b
    const t = split("horizontal", 0.5, leaf("a"), leaf("b"));
    const r = splitPane(t, "b", "down", "c");
    expect(r).toEqual(
      split("horizontal", 0.5, leaf("a"), split("vertical", 0.5, leaf("b"), leaf("c")))
    );
  });

  it("returns the same tree when targetId is unknown", () => {
    const t = split("horizontal", 0.5, leaf("a"), leaf("b"));
    const r = splitPane(t, "ghost", "right", "c");
    expect(r).toBe(t); // identity preserved (no-op fast path)
  });

  it("preserves parent ratios while replacing only the target leaf", () => {
    const t = split("horizontal", 0.3, leaf("a"), leaf("b"));
    const r = splitPane(t, "a", "down", "c");
    expect(r.type).toBe("split");
    if (r.type !== "split") return;
    expect(r.ratio).toBe(0.3);
  });
});

// ============================================================================
// closePane
// ============================================================================

describe("closePane", () => {
  it("returns null when closing the only leaf in a single-leaf tree", () => {
    expect(closePane(leaf("a"), "a")).toBeNull();
  });

  it("promotes the sibling to the split's slot (parent = root)", () => {
    const t = split("horizontal", 0.5, leaf("a"), leaf("b"));
    expect(closePane(t, "a")).toEqual(leaf("b"));
    expect(closePane(t, "b")).toEqual(leaf("a"));
  });

  it("promotes nested sibling subtrees correctly", () => {
    //          H 0.5
    //         /     \
    //    V 0.5      leaf c
    //    /   \
    // leaf a leaf b
    const t = split(
      "horizontal",
      0.5,
      split("vertical", 0.5, leaf("a"), leaf("b")),
      leaf("c")
    );
    // Close 'c' → left subtree V 0.5 (a, b) promoted to root
    expect(closePane(t, "c")).toEqual(
      split("vertical", 0.5, leaf("a"), leaf("b"))
    );
    // Close 'a' → b's leaf promoted to V's slot; H becomes H(b, c)
    expect(closePane(t, "a")).toEqual(
      split("horizontal", 0.5, leaf("b"), leaf("c"))
    );
  });

  it("returns the tree unchanged for unknown ids", () => {
    const t = split("horizontal", 0.5, leaf("a"), leaf("b"));
    expect(closePane(t, "ghost")).toBe(t);
  });

  it("preserves grandparent ratios when a child split collapses", () => {
    const t = split(
      "horizontal",
      0.7,
      split("vertical", 0.5, leaf("a"), leaf("b")),
      leaf("c")
    );
    const r = closePane(t, "c");
    // Closing c removes the entire right side, promoting the left subtree.
    expect(r).toEqual(split("vertical", 0.5, leaf("a"), leaf("b")));
  });
});

// ============================================================================
// resizeSplit
// ============================================================================

describe("resizeSplit", () => {
  it("sets the ratio of the split between two adjacent leaves", () => {
    const t = split("horizontal", 0.5, leaf("a"), leaf("b"));
    const r = resizeSplit(t, "a", "b", 0.3);
    expect(r).toEqual(split("horizontal", 0.3, leaf("a"), leaf("b")));
  });

  it("works regardless of the order of (a, b)", () => {
    const t = split("horizontal", 0.5, leaf("a"), leaf("b"));
    const r = resizeSplit(t, "b", "a", 0.3);
    expect(r).toEqual(split("horizontal", 0.3, leaf("a"), leaf("b")));
  });

  it("works with subtrees on one side", () => {
    //   H 0.5
    //  /     \
    // a    V 0.5
    //      / \
    //     b   c
    const t = split(
      "horizontal",
      0.5,
      leaf("a"),
      split("vertical", 0.5, leaf("b"), leaf("c"))
    );
    // Resizing the top-level split between 'a' (left subtree) and 'b' or 'c'
    // (anything inside the right subtree) updates the H split.
    const r = resizeSplit(t, "a", "b", 0.2);
    expect(r.type).toBe("split");
    if (r.type !== "split") return;
    expect(r.ratio).toBe(0.2);
  });

  it("leaves unrelated splits untouched", () => {
    const t = split(
      "horizontal",
      0.5,
      leaf("a"),
      split("vertical", 0.5, leaf("b"), leaf("c"))
    );
    const r = resizeSplit(t, "b", "c", 0.7);
    // The V split between b and c should now be 0.7
    expect(r).toEqual(
      split("horizontal", 0.5, leaf("a"), split("vertical", 0.7, leaf("b"), leaf("c")))
    );
  });

  it("is a no-op when the pair isn't a real split boundary", () => {
    const t = split("horizontal", 0.5, leaf("a"), leaf("b"));
    const r = resizeSplit(t, "a", "ghost", 0.3);
    // No split has 'a' and 'ghost' on opposite sides → tree unchanged.
    expect(r).toEqual(t);
  });
});

// ============================================================================
// moveFocus
// ============================================================================

describe("moveFocus", () => {
  // 2x2 grid:
  //   H 0.5
  //  /     \
  // V 0.5   V 0.5
  // / \     / \
  // a b    c d
  // Visual layout:
  //   a | c
  //   --+--
  //   b | d
  const t = split(
    "horizontal",
    0.5,
    split("vertical", 0.5, leaf("a"), leaf("b")),
    split("vertical", 0.5, leaf("c"), leaf("d"))
  );

  it("right from a → c", () => {
    expect(moveFocus(t, "a", "right")).toBe("c");
  });
  it("right from b → d", () => {
    expect(moveFocus(t, "b", "right")).toBe("d");
  });
  it("left from c → a", () => {
    expect(moveFocus(t, "c", "left")).toBe("a");
  });
  it("down from a → b", () => {
    expect(moveFocus(t, "a", "down")).toBe("b");
  });
  it("up from d → c", () => {
    expect(moveFocus(t, "d", "up")).toBe("c");
  });

  it("wraps to the opposite side when no leaf is in the requested direction", () => {
    // From the rightmost (c or d), pressing right should wrap.
    // d is at the right edge; nothing to its right.
    // The "wrap" picks the farthest leaf on the opposite side (left).
    expect(moveFocus(t, "d", "right")).toBe("a");
  });

  it("returns the same id if currentId is not in the tree", () => {
    expect(moveFocus(t, "ghost", "right")).toBe("ghost");
  });

  it("single-leaf tree always returns the same id", () => {
    expect(moveFocus(leaf("a"), "a", "right")).toBe("a");
  });

  it("complex asymmetric layout (3 columns)", () => {
    //   H 0.33
    //   /    \
    //  a    H 0.5
    //       /   \
    //      b    c
    const tri = split(
      "horizontal",
      0.33,
      leaf("a"),
      split("horizontal", 0.5, leaf("b"), leaf("c"))
    );
    expect(moveFocus(tri, "a", "right")).toBe("b");
    expect(moveFocus(tri, "b", "right")).toBe("c");
    expect(moveFocus(tri, "c", "left")).toBe("b");
    expect(moveFocus(tri, "b", "left")).toBe("a");
  });
});

// ============================================================================
// Leaf launch data (session restore — features A + B)
// ============================================================================

describe("leaf launch data", () => {
  const shell = { kind: "pwsh", path: "pwsh.exe" } as const;

  it("stores optional shell + startupCommand", () => {
    expect(leaf("p1", { shell, startupCommand: "claude" })).toEqual({
      type: "leaf",
      paneId: "p1",
      shell,
      startupCommand: "claude",
    });
  });

  it("stays minimal when no launch data is given", () => {
    expect(leaf("p1")).toEqual({ type: "leaf", paneId: "p1" });
    expect(leaf("p1", {})).toEqual({ type: "leaf", paneId: "p1" });
  });

  it("splitPane preserves the existing pane's shell + command", () => {
    const root = leaf("p1", { shell, startupCommand: "claude" });
    const next = splitPane(root, "p1", "right", "p2");
    expect(next).toEqual(
      split(
        "horizontal",
        DEFAULT_RATIO,
        { type: "leaf", paneId: "p1", shell, startupCommand: "claude" },
        { type: "leaf", paneId: "p2" }
      )
    );
  });
});
