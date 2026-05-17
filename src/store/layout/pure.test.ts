import { describe, it, expect } from "vitest";
import { produce } from "immer";
import {
  emptyLayout,
  addPane,
  removePane,
  focusPane,
  moveFocus,
} from "./pure";

describe("emptyLayout", () => {
  it("returns no panes and no focus", () => {
    expect(emptyLayout()).toEqual({ paneIds: [], focusedPaneId: null });
  });
});

describe("addPane", () => {
  it("appends a pane and focuses it", () => {
    const s = produce(emptyLayout(), (d) => addPane(d, "p1"));
    expect(s).toEqual({ paneIds: ["p1"], focusedPaneId: "p1" });
  });

  it("appends multiple panes preserving order, focuses the most recent", () => {
    const s = produce(emptyLayout(), (d) => {
      addPane(d, "p1");
      addPane(d, "p2");
      addPane(d, "p3");
    });
    expect(s).toEqual({ paneIds: ["p1", "p2", "p3"], focusedPaneId: "p3" });
  });

  it("is idempotent on re-add of an existing paneId", () => {
    const s = produce(emptyLayout(), (d) => {
      addPane(d, "p1");
      addPane(d, "p2");
      addPane(d, "p1"); // duplicate
    });
    expect(s).toEqual({ paneIds: ["p1", "p2"], focusedPaneId: "p2" });
  });
});

describe("removePane", () => {
  it("removes a non-focused pane without changing focus", () => {
    const start = produce(emptyLayout(), (d) => {
      addPane(d, "p1");
      addPane(d, "p2");
    });
    const s = produce(start, (d) => removePane(d, "p1"));
    expect(s).toEqual({ paneIds: ["p2"], focusedPaneId: "p2" });
  });

  it("when removing the focused pane (not at index 0), focus shifts to the previous", () => {
    const start = produce(emptyLayout(), (d) => {
      addPane(d, "p1");
      addPane(d, "p2");
      addPane(d, "p3");
      // focus is now p3
    });
    const s = produce(start, (d) => removePane(d, "p3"));
    expect(s).toEqual({ paneIds: ["p1", "p2"], focusedPaneId: "p2" });
  });

  it("when removing the focused pane at index 0, focus shifts to the new index 0", () => {
    const start = produce(emptyLayout(), (d) => {
      addPane(d, "p1");
      addPane(d, "p2");
      focusPane(d, "p1");
    });
    const s = produce(start, (d) => removePane(d, "p1"));
    expect(s).toEqual({ paneIds: ["p2"], focusedPaneId: "p2" });
  });

  it("when removing the only pane, focus becomes null", () => {
    const start = produce(emptyLayout(), (d) => addPane(d, "p1"));
    const s = produce(start, (d) => removePane(d, "p1"));
    expect(s).toEqual({ paneIds: [], focusedPaneId: null });
  });

  it("is a no-op for an unknown paneId", () => {
    const start = produce(emptyLayout(), (d) => addPane(d, "p1"));
    const s = produce(start, (d) => removePane(d, "p-ghost"));
    expect(s).toEqual(start);
  });
});

describe("focusPane", () => {
  it("sets focus to an existing pane", () => {
    const start = produce(emptyLayout(), (d) => {
      addPane(d, "p1");
      addPane(d, "p2");
      // focus is p2
    });
    const s = produce(start, (d) => focusPane(d, "p1"));
    expect(s.focusedPaneId).toBe("p1");
  });

  it("is a no-op for unknown paneId", () => {
    const start = produce(emptyLayout(), (d) => addPane(d, "p1"));
    const s = produce(start, (d) => focusPane(d, "ghost"));
    expect(s.focusedPaneId).toBe("p1");
  });
});

describe("moveFocus", () => {
  it("on an empty layout, focus stays null", () => {
    const s = produce(emptyLayout(), (d) => moveFocus(d, "next"));
    expect(s.focusedPaneId).toBeNull();
  });

  it('"next" advances forward', () => {
    const start = produce(emptyLayout(), (d) => {
      addPane(d, "p1");
      addPane(d, "p2");
      focusPane(d, "p1");
    });
    const s = produce(start, (d) => moveFocus(d, "next"));
    expect(s.focusedPaneId).toBe("p2");
  });

  it('"prev" advances backward', () => {
    const start = produce(emptyLayout(), (d) => {
      addPane(d, "p1");
      addPane(d, "p2");
      // focus is p2
    });
    const s = produce(start, (d) => moveFocus(d, "prev"));
    expect(s.focusedPaneId).toBe("p1");
  });

  it('"next" wraps from last to first', () => {
    const start = produce(emptyLayout(), (d) => {
      addPane(d, "p1");
      addPane(d, "p2");
      // focus is p2 (last)
    });
    const s = produce(start, (d) => moveFocus(d, "next"));
    expect(s.focusedPaneId).toBe("p1");
  });

  it('"prev" wraps from first to last', () => {
    const start = produce(emptyLayout(), (d) => {
      addPane(d, "p1");
      addPane(d, "p2");
      focusPane(d, "p1");
    });
    const s = produce(start, (d) => moveFocus(d, "prev"));
    expect(s.focusedPaneId).toBe("p2");
  });
});
