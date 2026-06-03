// src/store/dropTargetStore.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { useDropTargetStore } from "@/store/dropTargetStore";

describe("dropTargetStore", () => {
  beforeEach(() => useDropTargetStore.getState().setDropTarget(null));

  it("starts with no drop target", () => {
    expect(useDropTargetStore.getState().paneId).toBeNull();
  });
  it("sets and clears the highlighted pane", () => {
    useDropTargetStore.getState().setDropTarget("pane-3");
    expect(useDropTargetStore.getState().paneId).toBe("pane-3");
    useDropTargetStore.getState().setDropTarget(null);
    expect(useDropTargetStore.getState().paneId).toBeNull();
  });
});
