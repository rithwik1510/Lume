import { describe, it, expect, beforeEach } from "vitest";
import { useConfirmStore } from "@/store/confirmStore";

describe("confirmStore", () => {
  beforeEach(() => {
    // Reset by resolving any pending dialog.
    if (useConfirmStore.getState().open) {
      useConfirmStore.getState().resolve(false);
    }
  });

  it("confirm() resolves true when resolve(true) is called", async () => {
    const promise = useConfirmStore.getState().confirm({
      title: "test",
      message: "x",
    });
    expect(useConfirmStore.getState().open).toBe(true);
    useConfirmStore.getState().resolve(true);
    await expect(promise).resolves.toBe(true);
    expect(useConfirmStore.getState().open).toBe(false);
  });

  it("confirm() resolves false when resolve(false) is called", async () => {
    const promise = useConfirmStore.getState().confirm({ title: "t", message: "m" });
    useConfirmStore.getState().resolve(false);
    await expect(promise).resolves.toBe(false);
  });

  it("re-entrant confirm() while open immediately resolves false", async () => {
    const first = useConfirmStore.getState().confirm({ title: "a", message: "a" });
    const second = useConfirmStore.getState().confirm({ title: "b", message: "b" });
    await expect(second).resolves.toBe(false);
    // First should still be open and pending.
    expect(useConfirmStore.getState().open).toBe(true);
    useConfirmStore.getState().resolve(true);
    await expect(first).resolves.toBe(true);
  });

  it("resolve clears request and _resolve", () => {
    void useConfirmStore.getState().confirm({ title: "x", message: "y" });
    useConfirmStore.getState().resolve(true);
    const s = useConfirmStore.getState();
    expect(s.open).toBe(false);
    expect(s.request).toBeNull();
    expect(s._resolve).toBeNull();
  });
});
