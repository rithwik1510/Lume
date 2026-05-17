// Integration tests for the Zustand wrappers. The deep pure-function logic is
// already covered by layout/pure.test.ts and throttle.test.ts — this file only
// verifies that the store wires the wrappers together correctly and that the
// throttle is actually applied in ptyStore.markActivity.

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { useLayoutStore } from "./layoutStore";
import { usePtyStore } from "./ptyStore";
import type { Shell } from "@/types";

const wsl: Shell = { kind: "wsl", distro: "Ubuntu" };

describe("layoutStore", () => {
  beforeEach(() => useLayoutStore.getState().reset());

  it("addPane + focusPane + moveFocus flow", () => {
    const s = useLayoutStore.getState();
    s.addPane("p1");
    s.addPane("p2");
    s.addPane("p3");
    expect(useLayoutStore.getState().paneIds).toEqual(["p1", "p2", "p3"]);
    expect(useLayoutStore.getState().focusedPaneId).toBe("p3");

    s.focusPane("p1");
    expect(useLayoutStore.getState().focusedPaneId).toBe("p1");

    s.moveFocus("next");
    expect(useLayoutStore.getState().focusedPaneId).toBe("p2");

    s.moveFocus("prev");
    expect(useLayoutStore.getState().focusedPaneId).toBe("p1");
  });

  it("removePane shifts focus correctly", () => {
    const s = useLayoutStore.getState();
    s.addPane("p1");
    s.addPane("p2");
    s.removePane("p2");
    expect(useLayoutStore.getState().focusedPaneId).toBe("p1");
  });
});

describe("ptyStore", () => {
  beforeEach(() => {
    // Reset both store state and the module-level activity throttle so tests
    // are deterministic regardless of run order.
    usePtyStore.setState({ panes: {} });
    usePtyStore.getState()._resetActivityThrottle();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1_700_000_000_000)); // fixed deterministic clock
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
    const first = usePtyStore.getState().panes["p1"]?.lastActivity;
    expect(first).toBe(t0);

    s.markActivity("p1", t0 + 50);
    s.markActivity("p1", t0 + 199);
    // Throttle window is 200ms; these calls should be dropped.
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
    // p2's first call goes through even though p1 just emitted
    s.markActivity("p2", t0 + 10);
    expect(usePtyStore.getState().panes["p2"]?.lastActivity).toBe(t0 + 10);
  });

  it("markActivity on a missing pane is a no-op", () => {
    expect(() => usePtyStore.getState().markActivity("ghost")).not.toThrow();
    expect(usePtyStore.getState().panes["ghost"]).toBeUndefined();
  });
});
