import { describe, expect, it, beforeEach } from "vitest";
import { useContextMenuStore } from "@/store/contextMenuStore";

describe("contextMenuStore", () => {
  beforeEach(() => useContextMenuStore.getState().close());

  it("starts closed", () => {
    expect(useContextMenuStore.getState().open).toBe(false);
  });

  it("openMenu sets position and items", () => {
    useContextMenuStore.getState().openMenu(100, 200, [
      { label: "A", onClick: () => undefined },
      { label: "B", onClick: () => undefined },
    ]);
    const s = useContextMenuStore.getState();
    expect(s.open).toBe(true);
    expect(s.x).toBe(100);
    expect(s.y).toBe(200);
    expect(s.items.length).toBe(2);
  });

  it("close hides", () => {
    useContextMenuStore.getState().openMenu(0, 0, []);
    useContextMenuStore.getState().close();
    expect(useContextMenuStore.getState().open).toBe(false);
  });
});
