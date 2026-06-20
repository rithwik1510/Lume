import { describe, it, expect, beforeEach } from "vitest";

import {
  isVisible,
  shouldRenderLive,
  getVisiblePanes,
  setVisiblePanes,
  __resetVisibility,
} from "@/terminals/visibility";

describe("visibility", () => {
  beforeEach(() => __resetVisibility());

  it("starts empty and treats every pane as render-live (fail-safe)", () => {
    expect(getVisiblePanes().size).toBe(0);
    expect(isVisible("p1")).toBe(false);
    // Empty set → render everything live (today's behavior).
    expect(shouldRenderLive("p1")).toBe(true);
  });

  it("diffs entered/exited on replace", () => {
    let d = setVisiblePanes(new Set(["a", "b"]));
    expect(d.entered.sort()).toEqual(["a", "b"]);
    expect(d.exited).toEqual([]);

    d = setVisiblePanes(new Set(["b", "c"]));
    expect(d.entered).toEqual(["c"]);
    expect(d.exited).toEqual(["a"]);
  });

  it("with a non-empty set, only members render live", () => {
    setVisiblePanes(new Set(["a"]));
    expect(shouldRenderLive("a")).toBe(true);
    expect(shouldRenderLive("b")).toBe(false);
    expect(isVisible("b")).toBe(false);
  });

  it("no-op replace yields no transitions", () => {
    setVisiblePanes(new Set(["a", "b"]));
    const d = setVisiblePanes(new Set(["a", "b"]));
    expect(d.entered).toEqual([]);
    expect(d.exited).toEqual([]);
  });
});
