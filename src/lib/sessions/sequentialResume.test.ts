// sequentialResume — readiness-gated boot revive tests.
//
// Pins the anti-stampede contract: the focused session revives synchronously,
// each further session waits for the previous one's autorun panes to report
// prompt-ready (or a timeout), with a small gap floor, and cancel tears the
// whole chain down.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// sessionsStore pulls in the persist middleware (plugin-store) on import
// (needed for the integration case only, but mocks must be top-level).
vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: vi.fn(async () => null),
    set: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    save: vi.fn(async () => undefined),
  })),
}));

import {
  sequentialResume,
  SESSION_READY_TIMEOUT_MS,
  MIN_GAP_MS,
  type SequentialResumeDeps,
} from "@/lib/sessions/sequentialResume";
import { useSessionsStore, paneLaunchSpec } from "@/store/sessionsStore";
import { leaf, leaves } from "@/store/layout/tree";
import { onCommandEvent, handleOsc133, disposeCommandTracker } from "@/sessions/commandTracker";

/** Fully-faked deps: a manual prompt-ready emitter + an autorun fixture map. */
function makeDeps(autorunMap: Record<string, string[]> = {}) {
  const listeners = new Set<(paneId: string) => void>();
  let disposeCount = 0;
  const deps: SequentialResumeDeps = {
    resumeOne: vi.fn(),
    onPaneReady: vi.fn((cb: (paneId: string) => void) => {
      listeners.add(cb);
      return () => {
        if (listeners.delete(cb)) disposeCount++;
      };
    }),
    autorunPaneIds: (sid: string) => autorunMap[sid] ?? [],
  };
  const fireReady = (paneId: string) => {
    for (const l of [...listeners]) l(paneId);
  };
  return {
    deps,
    fireReady,
    listenerCount: () => listeners.size,
    disposeCount: () => disposeCount,
  };
}

const resumeCalls = (deps: SequentialResumeDeps) => (deps.resumeOne as ReturnType<typeof vi.fn>).mock.calls;

let cancel: (() => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cancel?.();
  cancel = null;
  vi.useRealTimers();
});

describe("sequentialResume — unit (faked deps)", () => {
  it("focused session resumes synchronously, alone, focused", () => {
    const { deps } = makeDeps({ b: ["p-b"] });
    cancel = sequentialResume(["a", "b", "c"], "b", deps);
    expect(resumeCalls(deps)).toEqual([[["b"], "b"]]);
  });

  it("next session waits for previous readiness, not just the gap", () => {
    const { deps, fireReady } = makeDeps({ a: ["p-a1", "p-a2"] });
    cancel = sequentialResume(["a", "b", "c"], "a", deps);
    expect(resumeCalls(deps)).toHaveLength(1);

    // Gap (500ms) long past, readiness not fired → still waiting at t=2999.
    vi.advanceTimersByTime(2999);
    expect(resumeCalls(deps)).toHaveLength(1);

    // t=3s: all of session a's autorun panes report prompt-ready → b revives
    // now (~3s), NOT back at gapMs.
    vi.advanceTimersByTime(1);
    fireReady("p-a1");
    fireReady("p-a2");
    expect(resumeCalls(deps)).toHaveLength(2);
    expect(resumeCalls(deps)[1]).toEqual([["b"], "a"]);
  });

  it("timeout fallback: each step times out from the previous revive", () => {
    const { deps } = makeDeps({ a: ["p-a"], b: ["p-b"] });
    cancel = sequentialResume(["a", "b", "c"], "a", deps);

    vi.advanceTimersByTime(SESSION_READY_TIMEOUT_MS - 1);
    expect(resumeCalls(deps)).toHaveLength(1);
    vi.advanceTimersByTime(1); // t = 1× timeout → b
    expect(resumeCalls(deps)).toHaveLength(2);
    expect(resumeCalls(deps)[1]).toEqual([["b"], "a"]);

    vi.advanceTimersByTime(SESSION_READY_TIMEOUT_MS - 1);
    expect(resumeCalls(deps)).toHaveLength(2);
    vi.advanceTimersByTime(1); // t = 2× timeout (b's own timeout) → c
    expect(resumeCalls(deps)).toHaveLength(3);
    expect(resumeCalls(deps)[2]).toEqual([["c"], "a"]);
  });

  it("no-autorun session gates only on gapMs", () => {
    const { deps } = makeDeps({ a: [] });
    cancel = sequentialResume(["a", "b"], "a", deps);

    vi.advanceTimersByTime(MIN_GAP_MS - 1);
    expect(resumeCalls(deps)).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(resumeCalls(deps)).toHaveLength(2);
    expect(resumeCalls(deps)[1]).toEqual([["b"], "a"]);
  });

  it("partial readiness keeps waiting", () => {
    const { deps, fireReady } = makeDeps({ a: ["p-a1", "p-a2"] });
    cancel = sequentialResume(["a", "b"], "a", deps);

    vi.advanceTimersByTime(1000);
    fireReady("p-a1"); // one of two panes ready
    vi.advanceTimersByTime(SESSION_READY_TIMEOUT_MS - 1001); // just under timeout
    expect(resumeCalls(deps)).toHaveLength(1);

    fireReady("p-a2"); // second pane → fully ready
    expect(resumeCalls(deps)).toHaveLength(2);
  });

  it("cancel stops everything", () => {
    const { deps, listenerCount, disposeCount } = makeDeps({ a: ["p-a"] });
    const cancelFn = sequentialResume(["a", "b", "c"], "a", deps);
    expect(resumeCalls(deps)).toHaveLength(1);
    expect(listenerCount()).toBe(1);

    cancelFn();
    vi.advanceTimersByTime(60_000);
    expect(resumeCalls(deps)).toHaveLength(1);
    expect(listenerCount()).toBe(0);
    expect(disposeCount()).toBe(1);

    cancelFn(); // idempotent
    expect(disposeCount()).toBe(1);
  });

  it("stale activeId falls back to the first id", () => {
    const { deps } = makeDeps();
    cancel = sequentialResume(["a", "b"], "gone-id", deps);
    expect(resumeCalls(deps)[0]).toEqual([["a"], "a"]);
  });

  it("empty ids is a no-op", () => {
    const { deps } = makeDeps();
    const cancelFn = sequentialResume([], null, deps);
    vi.advanceTimersByTime(60_000);
    expect(resumeCalls(deps)).toHaveLength(0);
    expect(() => cancelFn()).not.toThrow();
  });
});

describe("sequentialResume — integration (real store + real commandTracker)", () => {
  beforeEach(() => {
    useSessionsStore.setState(useSessionsStore.getInitialState(), true);
    disposeCommandTracker();
  });
  afterEach(() => {
    disposeCommandTracker();
  });

  it("revives the fleet one by one, keeps focus on the original session", () => {
    const s = useSessionsStore.getState();
    const a = s.createSession("/a");
    const b = s.createSession("/b");
    const c = s.createSession("/c");
    useSessionsStore.getState().setLayoutRoot(a, leaf("p-a", { startupCommand: "claude" }));
    useSessionsStore.getState().setLayoutRoot(b, leaf("p-b", { startupCommand: "claude" }));
    useSessionsStore.getState().setLayoutRoot(c, leaf("p-c", { startupCommand: "claude" }));

    // Same deps shape as the App.tsx wiring.
    cancel = sequentialResume([a, b, c], b, {
      resumeOne: useSessionsStore.getState().resumeSessions,
      onPaneReady: (cb) =>
        onCommandEvent((evt) => {
          if (evt.type === "prompt-ready") cb(evt.paneId);
        }),
      autorunPaneIds: (sid) => {
        const state = useSessionsStore.getState();
        const sess = state.sessions[sid];
        if (!sess?.layoutRoot) return [];
        return leaves(sess.layoutRoot).filter(
          (paneId) => !!paneLaunchSpec(state, paneId)?.startupCommand?.trim()
        );
      },
    });

    // b (last-active) revives synchronously and takes focus.
    let st = useSessionsStore.getState();
    expect(st.sessions[b].status).toBe("active");
    expect(st.sessions[a].status).toBe("stopped");
    expect(st.sessions[c].status).toBe("stopped");
    expect(st.activeSessionId).toBe(b);

    // b's pane reaches its prompt (real OSC 133;B through the tracker) → a.
    vi.advanceTimersByTime(MIN_GAP_MS);
    handleOsc133("p-b", "B");
    st = useSessionsStore.getState();
    expect(st.sessions[a].status).toBe("active");
    expect(st.sessions[c].status).toBe("stopped");

    // a's pane reaches its prompt → c.
    vi.advanceTimersByTime(MIN_GAP_MS);
    handleOsc133("p-a", "B");
    st = useSessionsStore.getState();
    expect(st.sessions[c].status).toBe("active");

    // All active; focus never left the originally-active session.
    expect(st.activeSessionId).toBe(b);
    expect(st.lastActiveSessionId).toBe(b);
  });
});
