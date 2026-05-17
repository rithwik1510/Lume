import { describe, it, expect } from "vitest";
import { createThrottle } from "./throttle";

describe("createThrottle", () => {
  it("emits on the first call for a key", () => {
    const t = createThrottle(200);
    expect(t.shouldEmit("pane-1", 1000)).toBe(true);
  });

  it("drops a second call within the window", () => {
    const t = createThrottle(200);
    t.shouldEmit("pane-1", 1000);
    expect(t.shouldEmit("pane-1", 1100)).toBe(false);
    expect(t.shouldEmit("pane-1", 1199)).toBe(false);
  });

  it("emits again exactly at the window boundary", () => {
    const t = createThrottle(200);
    t.shouldEmit("pane-1", 1000);
    expect(t.shouldEmit("pane-1", 1200)).toBe(true);
  });

  it("tracks keys independently", () => {
    const t = createThrottle(200);
    expect(t.shouldEmit("pane-1", 1000)).toBe(true);
    // pane-2's first call goes through even though pane-1's last emit was recent
    expect(t.shouldEmit("pane-2", 1050)).toBe(true);
    // each still throttles its own subsequent calls
    expect(t.shouldEmit("pane-1", 1100)).toBe(false);
    expect(t.shouldEmit("pane-2", 1100)).toBe(false);
  });

  it("rate matches DESIGN spec (200ms window → max 5 emits/sec)", () => {
    const t = createThrottle(200);
    let emits = 0;
    // Simulate 1s of traffic with one call per 10ms
    for (let now = 0; now < 1000; now += 10) {
      if (t.shouldEmit("pane-1", now)) emits++;
    }
    expect(emits).toBe(5);
  });

  it("reset(key) clears only that key", () => {
    const t = createThrottle(200);
    t.shouldEmit("pane-1", 1000);
    t.shouldEmit("pane-2", 1000);
    t.reset("pane-1");
    expect(t.shouldEmit("pane-1", 1050)).toBe(true);
    expect(t.shouldEmit("pane-2", 1050)).toBe(false);
  });

  it("reset() clears all keys", () => {
    const t = createThrottle(200);
    t.shouldEmit("pane-1", 1000);
    t.shouldEmit("pane-2", 1000);
    t.reset();
    expect(t.shouldEmit("pane-1", 1050)).toBe(true);
    expect(t.shouldEmit("pane-2", 1050)).toBe(true);
  });

  it("rejects negative windowMs at construction", () => {
    expect(() => createThrottle(-1)).toThrow(/windowMs/);
  });

  it("windowMs=0 means every call emits", () => {
    const t = createThrottle(0);
    expect(t.shouldEmit("k", 100)).toBe(true);
    expect(t.shouldEmit("k", 100)).toBe(true);
    expect(t.shouldEmit("k", 101)).toBe(true);
  });
});
