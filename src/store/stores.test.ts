// Integration tests for the Zustand wrappers. Deep tree-op logic is covered
// by layout/tree.test.ts and throttle.test.ts — this file only verifies that
// the layoutStore wires the ops together correctly (focus follows splits,
// last-pane lock, focus shifts on close) and that the ptyStore throttle is
// applied in markActivity.

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

// layoutStore is wrapped with zustand/middleware/persist backed by
// @tauri-apps/plugin-store; mock it so the test runner doesn't try to call
// into Tauri at module load. `get` returns null so rehydrate is a no-op.
vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: vi.fn(async () => null),
    set: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  })),
}));

import { useLayoutStore, getPaneIds } from "./layoutStore";
import { usePtyStore } from "./ptyStore";
import type { Shell } from "@/types";

const wsl: Shell = { kind: "wsl", distro: "Ubuntu" };

describe("layoutStore", () => {
  beforeEach(() => useLayoutStore.getState().reset());

  it("initWithFirstPane creates a single-leaf tree and focuses it", () => {
    useLayoutStore.getState().initWithFirstPane("p1");
    const s = useLayoutStore.getState();
    expect(s.root).toEqual({ type: "leaf", paneId: "p1" });
    expect(s.focusedPaneId).toBe("p1");
    expect(getPaneIds(s)).toEqual(["p1"]);
  });

  it("splitPane chains and shifts focus to the newest pane", () => {
    const s = useLayoutStore.getState();
    s.initWithFirstPane("p1");
    s.splitPane("right", "p2");
    s.splitPane("down", "p3");
    expect(useLayoutStore.getState().focusedPaneId).toBe("p3");
    expect(getPaneIds(useLayoutStore.getState())).toEqual(["p1", "p2", "p3"]);
  });

  it("splitPane refuses to add a duplicate paneId", () => {
    const s = useLayoutStore.getState();
    s.initWithFirstPane("p1");
    s.splitPane("right", "p2");
    s.splitPane("right", "p1"); // duplicate — must be ignored
    expect(getPaneIds(useLayoutStore.getState())).toEqual(["p1", "p2"]);
  });

  it("focusPane sets focus iff the leaf exists", () => {
    const s = useLayoutStore.getState();
    s.initWithFirstPane("p1");
    s.splitPane("right", "p2");
    s.focusPane("p1");
    expect(useLayoutStore.getState().focusedPaneId).toBe("p1");
    s.focusPane("ghost");
    expect(useLayoutStore.getState().focusedPaneId).toBe("p1");
  });

  it("closePane refuses to close the last leaf (last-pane lock)", () => {
    const s = useLayoutStore.getState();
    s.initWithFirstPane("p1");
    s.closePane("p1");
    const after = useLayoutStore.getState();
    expect(after.root).toEqual({ type: "leaf", paneId: "p1" });
    expect(after.focusedPaneId).toBe("p1");
  });

  it("closePane shifts focus to a neighbour when the focused leaf is removed", () => {
    const s = useLayoutStore.getState();
    s.initWithFirstPane("p1");
    s.splitPane("right", "p2");
    s.splitPane("right", "p3");
    // Focus is now p3. Closing p3 should shift focus to p2 (its left neighbour).
    s.closePane("p3");
    expect(useLayoutStore.getState().focusedPaneId).toBe("p2");
  });

  it("moveFocus walks the geometric layout", () => {
    const s = useLayoutStore.getState();
    s.initWithFirstPane("p1");
    s.splitPane("right", "p2"); // tree: H(p1, p2), focus p2
    s.focusPane("p1");
    s.moveFocus("right");
    expect(useLayoutStore.getState().focusedPaneId).toBe("p2");
  });

  it("resizeSplit clamps the ratio to [MIN, MAX]", () => {
    const s = useLayoutStore.getState();
    s.initWithFirstPane("p1");
    s.splitPane("right", "p2");
    s.resizeSplit("p1", "p2", 0.01); // below MIN
    const r = useLayoutStore.getState().root;
    expect(r?.type).toBe("split");
    if (r?.type !== "split") return;
    expect(r.ratio).toBeGreaterThanOrEqual(0.05);
  });
});

describe("ptyStore", () => {
  beforeEach(() => {
    usePtyStore.setState({ panes: {} });
    usePtyStore.getState()._resetActivityThrottle();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_700_000_000_000));
  });
  afterEach(() => vi.useRealTimers());

  it("addPane creates spawning record with deterministic shape", () => {
    usePtyStore.getState().addPane("p1", wsl);
    const meta = usePtyStore.getState().panes["p1"];
    expect(meta).toBeDefined();
    expect(meta?.paneId).toBe("p1");
    expect(meta?.status).toBe("spawning");
    expect(meta?.cwd).toBeNull();
    expect(meta?.errorReason).toBeNull();
    expect(meta?.shell).toEqual(wsl);
  });

  it("setStatus transitions the pane status", () => {
    const s = usePtyStore.getState();
    s.addPane("p1", wsl);
    s.setStatus("p1", "running");
    expect(usePtyStore.getState().panes["p1"]?.status).toBe("running");
    s.setStatus("p1", "errored", "spawn failed");
    expect(usePtyStore.getState().panes["p1"]?.status).toBe("errored");
    expect(usePtyStore.getState().panes["p1"]?.errorReason).toBe("spawn failed");
  });

  it("removePane drops the pane record", () => {
    const s = usePtyStore.getState();
    s.addPane("p1", wsl);
    s.removePane("p1");
    expect(usePtyStore.getState().panes["p1"]).toBeUndefined();
  });

  it("markActivity is throttled to 200ms per pane", () => {
    const s = usePtyStore.getState();
    s.addPane("p1", wsl);
    const t0 = Date.now();
    s.markActivity("p1", t0);
    expect(usePtyStore.getState().panes["p1"]?.lastActivity).toBe(t0);
    s.markActivity("p1", t0 + 50);
    s.markActivity("p1", t0 + 199);
    expect(usePtyStore.getState().panes["p1"]?.lastActivity).toBe(t0);
    s.markActivity("p1", t0 + 200);
    expect(usePtyStore.getState().panes["p1"]?.lastActivity).toBe(t0 + 200);
  });

  it("markActivity is independent per pane", () => {
    const s = usePtyStore.getState();
    s.addPane("p1", wsl);
    s.addPane("p2", wsl);
    const t0 = Date.now();
    s.markActivity("p1", t0);
    s.markActivity("p2", t0 + 10);
    expect(usePtyStore.getState().panes["p2"]?.lastActivity).toBe(t0 + 10);
  });

  it("markActivity on a missing pane is a no-op", () => {
    expect(() => usePtyStore.getState().markActivity("ghost")).not.toThrow();
    expect(usePtyStore.getState().panes["ghost"]).toBeUndefined();
  });
});
