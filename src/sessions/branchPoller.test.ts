// branchPoller — single-flight cycle tests.
//
// The 2026-06-12 incident's second half: tick() fired one fire-and-forget
// git_current_branch per active session every 5s with no overlap guard, so a
// cycle slower than the interval stacked unboundedly. These tests pin the
// fixed behavior: cycles are serialized (max concurrency 1), a slow cycle is
// never overlapped by the next tick, and a blurred window polls nothing.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// sessionsStore pulls in the persist middleware (plugin-store) on import.
vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: vi.fn(async () => null),
    set: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    save: vi.fn(async () => undefined),
  })),
}));

const { invokeMock, windowListeners } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  windowListeners: new Map<string, () => void>(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    listen: vi.fn(async (event: string, cb: () => void) => {
      windowListeners.set(event, cb);
      return () => {
        windowListeners.delete(event);
      };
    }),
  }),
}));

import { useSessionsStore } from "@/store/sessionsStore";
import { installBranchPoller } from "@/sessions/branchPoller";

/** Seed n sessions and mark them active BEFORE the poller installs, so the
 *  revive-subscription's immediate pollOne never fires during these tests —
 *  every invoke we count comes from a polling cycle. */
function seedActiveSessions(n: number): string[] {
  const s = useSessionsStore.getState();
  const ids: string[] = [];
  for (let i = 0; i < n; i++) ids.push(s.createSession(`/repo-${i}`));
  useSessionsStore.getState().resumeSessions(ids, ids[0]);
  return ids;
}

let dispose: (() => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  useSessionsStore.setState(useSessionsStore.getInitialState(), true);
  invokeMock.mockReset();
  windowListeners.clear();
});

afterEach(() => {
  dispose?.();
  dispose = null;
  vi.useRealTimers();
});

describe("branchPoller — single-flight cycles", () => {
  it("one tick polls each active session exactly once", async () => {
    invokeMock.mockResolvedValue("main");
    seedActiveSessions(3);
    dispose = installBranchPoller();

    // Flush the install-time initial scan, then count one interval tick.
    await vi.advanceTimersByTimeAsync(0);
    expect(invokeMock).toHaveBeenCalledTimes(3);
    invokeMock.mockClear();

    await vi.advanceTimersByTimeAsync(5000);
    expect(invokeMock).toHaveBeenCalledTimes(3);
  });

  it("a slow cycle is never overlapped", async () => {
    // Each git call takes 12s of fake time — far slower than the 5s interval.
    invokeMock.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve("main"), 12_000))
    );
    seedActiveSessions(3);
    dispose = installBranchPoller(); // initial scan = cycle 1, call #1 at t=0

    // t=5s: the interval fires but cycle 1 is still on its first git call.
    await vi.advanceTimersByTimeAsync(5000);
    expect(invokeMock).toHaveBeenCalledTimes(1);

    // t=15s: ticks at 10s and 15s were skipped; cycle 1 advanced to call #2
    // (at t=12s). Without the guard there would be 3 calls per elapsed tick.
    await vi.advanceTimersByTimeAsync(10_000);
    expect(invokeMock).toHaveBeenCalledTimes(2);

    // t=36s: cycle 1 completes (3 serial × 12s) — still only its own 3 calls.
    await vi.advanceTimersByTimeAsync(21_000);
    expect(invokeMock).toHaveBeenCalledTimes(3);

    // t=40s: the next tick after resolution starts cycle 2.
    await vi.advanceTimersByTimeAsync(4000);
    expect(invokeMock).toHaveBeenCalledTimes(4);
  });

  it("polls are serial — max in-flight git calls is 1", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    invokeMock.mockImplementation(() => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      return new Promise((resolve) =>
        setTimeout(() => {
          inFlight--;
          resolve("main");
        }, 1000)
      );
    });
    seedActiveSessions(3);
    dispose = installBranchPoller();

    // Initial cycle (3s serial) plus two interval cycles.
    await vi.advanceTimersByTimeAsync(15_000);
    expect(invokeMock.mock.calls.length).toBeGreaterThanOrEqual(6);
    expect(maxInFlight).toBe(1);
  });

  it("blurred window polls nothing", async () => {
    invokeMock.mockResolvedValue("main");
    seedActiveSessions(3);
    dispose = installBranchPoller();
    await vi.advanceTimersByTimeAsync(0); // flush initial scan + listener setup

    const blur = windowListeners.get("tauri://blur");
    expect(blur).toBeDefined();
    blur!();
    invokeMock.mockClear();

    await vi.advanceTimersByTimeAsync(5000);
    expect(invokeMock).toHaveBeenCalledTimes(0);
  });
});
