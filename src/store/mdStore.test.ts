// src/store/mdStore.test.ts
import { describe, expect, it, beforeEach, vi } from "vitest";
import { useMdStore } from "@/store/mdStore";

vi.mock("@/lib/fsClient", () => ({
  readTextFile: vi.fn(async (p: string) => `contents of ${p}`),
  writeTextFile: vi.fn(async () => undefined),
}));

describe("mdStore — Quick Viewer", () => {
  beforeEach(() => useMdStore.getState().reset());

  it("starts with quick viewer closed", () => {
    const s = useMdStore.getState();
    expect(s.quickViewer.open).toBe(false);
    expect(s.quickViewer.path).toBeNull();
  });

  it("openMdInQuickViewer loads file contents", async () => {
    await useMdStore.getState().openMdInQuickViewer("/tmp/x.md");
    const s = useMdStore.getState();
    expect(s.quickViewer.open).toBe(true);
    expect(s.quickViewer.path).toBe("/tmp/x.md");
    expect(s.quickViewer.content).toBe("contents of /tmp/x.md");
  });

  it("closeQuickViewer resets state", async () => {
    await useMdStore.getState().openMdInQuickViewer("/tmp/x.md");
    useMdStore.getState().closeQuickViewer();
    const s = useMdStore.getState();
    expect(s.quickViewer.open).toBe(false);
    expect(s.quickViewer.path).toBeNull();
    expect(s.quickViewer.content).toBe("");
  });
});
