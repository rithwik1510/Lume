import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  subscriber: null as null | (() => void),
  visible: [] as string[],
}));

vi.mock("@/store/sessionsStore", () => ({
  useSessionsStore: {
    getState: () => ({}),
    subscribe: (cb: () => void) => {
      h.subscriber = cb;
      return () => {
        h.subscriber = null;
      };
    },
  },
  getVisiblePaneIds: () => h.visible,
}));

vi.mock("@/terminals/registry", () => ({
  acquireRenderer: vi.fn(),
  markBackgroundRenderer: vi.fn(),
}));

vi.mock("@/terminals/renderSink", () => ({ foreground: vi.fn() }));

import { installRenderGovernor } from "@/terminals/renderGovernor";
import { acquireRenderer, markBackgroundRenderer } from "@/terminals/registry";
import { foreground } from "@/terminals/renderSink";
import { __resetVisibility, isVisible } from "@/terminals/visibility";

describe("renderGovernor", () => {
  beforeEach(() => {
    __resetVisibility();
    vi.clearAllMocks();
    h.subscriber = null;
    h.visible = [];
  });

  it("seeds the visible set on install and acquires + foregrounds each pane", () => {
    h.visible = ["a", "b"];
    const dispose = installRenderGovernor();

    expect(acquireRenderer).toHaveBeenCalledWith("a");
    expect(acquireRenderer).toHaveBeenCalledWith("b");
    expect(foreground).toHaveBeenCalledWith("a");
    expect(foreground).toHaveBeenCalledWith("b");
    expect(isVisible("a")).toBe(true);
    dispose();
  });

  it("on a session switch, backgrounds the old panes and foregrounds the new", () => {
    h.visible = ["a"];
    installRenderGovernor();
    vi.clearAllMocks();

    h.visible = ["b"];
    h.subscriber!(); // store change

    expect(markBackgroundRenderer).toHaveBeenCalledWith("a");
    expect(acquireRenderer).toHaveBeenCalledWith("b");
    expect(foreground).toHaveBeenCalledWith("b");
    expect(isVisible("a")).toBe(false);
    expect(isVisible("b")).toBe(true);
  });

  it("a split shows both sessions' panes at once", () => {
    h.visible = ["a"];
    installRenderGovernor();
    vi.clearAllMocks();

    h.visible = ["a", "b", "c"]; // split partner added
    h.subscriber!();

    expect(markBackgroundRenderer).not.toHaveBeenCalled();
    expect(acquireRenderer).toHaveBeenCalledWith("b");
    expect(acquireRenderer).toHaveBeenCalledWith("c");
    expect(acquireRenderer).not.toHaveBeenCalledWith("a"); // already visible
  });

  it("does nothing when the visible set is unchanged", () => {
    h.visible = ["a", "b"];
    installRenderGovernor();
    vi.clearAllMocks();

    h.subscriber!(); // same set
    expect(acquireRenderer).not.toHaveBeenCalled();
    expect(markBackgroundRenderer).not.toHaveBeenCalled();
    expect(foreground).not.toHaveBeenCalled();
  });
});
