import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

// sessionsStore pulls in the persist middleware (plugin-store) on import.
vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: vi.fn(async () => null),
    set: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  })),
}));
// agentTracker imports `listen`; we never call installAgentTracker in these
// tests (we drive applyAgentEvent directly), but stub the module so the import
// resolves without a Tauri runtime.
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => undefined),
}));

import { useSessionsStore } from "@/store/sessionsStore";
import { useAgentStore } from "@/store/agentStore";
import { leaf } from "@/store/layout/tree";
import {
  applyAgentEvent,
  transitionFor,
  forgetPaneAgent,
  disposeAgentTracker,
  type AgentEvent,
} from "@/sessions/agentTracker";
import {
  noteOutput,
  disposeAttentionTracker,
  paneHasLiveAgent,
} from "@/sessions/attentionTracker";

function sessionWithPane(folder: string, paneId: string): string {
  const s = useSessionsStore.getState();
  const id = s.createSession(folder);
  s.setLayoutRoot(id, leaf(paneId));
  return id;
}

const phase = (paneId: string) => useAgentStore.getState().panes[paneId]?.phase;
const working = (id: string) => useSessionsStore.getState().sessions[id].working;

function ev(paneId: string, event: string, extra: Partial<AgentEvent> = {}): AgentEvent {
  return { paneId, event, ...extra };
}

/** A REAL cadence stream (two throttled chunks inside SUSTAIN_MS) — used to
 *  prove cadence is/ isn't suppressed for a pane. */
function streamOutput(paneId: string): void {
  noteOutput(paneId);
  vi.advanceTimersByTime(250);
  noteOutput(paneId);
}

beforeEach(() => {
  useSessionsStore.setState(useSessionsStore.getInitialState(), true);
  disposeAgentTracker();
  disposeAttentionTracker();
  vi.useFakeTimers();
});
afterEach(() => {
  disposeAgentTracker();
  disposeAttentionTracker();
  vi.useRealTimers();
});

describe("agentTracker — transitionFor (pure)", () => {
  it("maps each known event/kind to its transition", () => {
    expect(transitionFor("SessionStart")).toEqual({ type: "phase", phase: "idle" });
    expect(transitionFor("UserPromptSubmit")).toEqual({ type: "phase", phase: "working" });
    expect(transitionFor("Stop")).toEqual({ type: "phase", phase: "your-move" });
    expect(transitionFor("SessionEnd")).toEqual({ type: "end" });
    expect(transitionFor("Notification", "permission_prompt")).toEqual({
      type: "phase",
      phase: "permission",
    });
    // idle_prompt collapses into your-move (locked Design).
    expect(transitionFor("Notification", "idle_prompt")).toEqual({
      type: "phase",
      phase: "your-move",
    });
  });

  it("tolerates unknown events and unknown notification kinds", () => {
    expect(transitionFor("PreToolUse")).toEqual({ type: "ignore" });
    expect(transitionFor("SomethingNew")).toEqual({ type: "ignore" });
    expect(transitionFor("Notification", "future_kind")).toEqual({ type: "ignore" });
    expect(transitionFor("Notification")).toEqual({ type: "ignore" });
  });
});

describe("agentTracker — state machine over a session lifecycle", () => {
  it("SessionStart → UserPromptSubmit → permission → Stop → SessionEnd", () => {
    const bg = sessionWithPane("/bg", "pane-bg");
    const fg = sessionWithPane("/fg", "pane-fg");
    useSessionsStore.getState().activateSession(fg);

    applyAgentEvent(ev("pane-bg", "SessionStart", { sessionId: "s1", transcriptPath: "/t" }));
    expect(phase("pane-bg")).toBe("idle");
    expect(useAgentStore.getState().panes["pane-bg"].agent).toBe("claude");
    expect(useAgentStore.getState().panes["pane-bg"].sessionId).toBe("s1");
    expect(paneHasLiveAgent("pane-bg")).toBe(true);
    expect(working(bg)).toBe(false); // idle is not working

    applyAgentEvent(ev("pane-bg", "UserPromptSubmit"));
    expect(phase("pane-bg")).toBe("working");
    expect(working(bg)).toBe(true); // class A drives the session working fact
    // Identity is preserved across the transition.
    expect(useAgentStore.getState().panes["pane-bg"].sessionId).toBe("s1");

    applyAgentEvent(ev("pane-bg", "Notification", { kind: "permission_prompt" }));
    expect(phase("pane-bg")).toBe("permission");
    expect(working(bg)).toBe(false); // blocked is not working

    applyAgentEvent(ev("pane-bg", "Stop"));
    expect(phase("pane-bg")).toBe("your-move");
    expect(working(bg)).toBe(false);

    applyAgentEvent(ev("pane-bg", "SessionEnd"));
    expect(phase("pane-bg")).toBeUndefined(); // entry removed
    expect(paneHasLiveAgent("pane-bg")).toBe(false); // reverts to heuristics
  });

  it("idle_prompt notification also lands 'your-move'", () => {
    sessionWithPane("/bg", "pane-bg");
    applyAgentEvent(ev("pane-bg", "SessionStart"));
    applyAgentEvent(ev("pane-bg", "Notification", { kind: "idle_prompt" }));
    expect(phase("pane-bg")).toBe("your-move");
  });
});

describe("agentTracker — tolerance", () => {
  it("out-of-order: UserPromptSubmit before its SessionStart still works", () => {
    const bg = sessionWithPane("/bg", "pane-bg");
    const fg = sessionWithPane("/fg", "pane-fg");
    useSessionsStore.getState().activateSession(fg);

    applyAgentEvent(ev("pane-bg", "UserPromptSubmit"));
    expect(phase("pane-bg")).toBe("working");
    expect(useAgentStore.getState().panes["pane-bg"].agent).toBe("claude");
    expect(working(bg)).toBe(true);
  });

  it("unknown events never create or mutate agent state", () => {
    sessionWithPane("/bg", "pane-bg");
    applyAgentEvent(ev("pane-bg", "PreToolUse"));
    expect(phase("pane-bg")).toBeUndefined();
    expect(paneHasLiveAgent("pane-bg")).toBe(false);

    applyAgentEvent(ev("pane-bg", "SessionStart"));
    applyAgentEvent(ev("pane-bg", "UserPromptSubmit"));
    expect(phase("pane-bg")).toBe("working");
    applyAgentEvent(ev("pane-bg", "PostToolUse")); // unknown mid-turn → no change
    expect(phase("pane-bg")).toBe("working");
  });
});

describe("agentTracker — your-move acknowledgment (viewing calms the dot)", () => {
  it("a Stop on the session you're viewing lands idle, not your-move", () => {
    const fg = sessionWithPane("/fg", "pane-fg");
    useSessionsStore.getState().activateSession(fg);
    applyAgentEvent(ev("pane-fg", "SessionStart"));
    applyAgentEvent(ev("pane-fg", "UserPromptSubmit"));
    applyAgentEvent(ev("pane-fg", "Stop"));
    // You watched the turn complete — no dot debt to carry into the sidebar.
    expect(phase("pane-fg")).toBe("idle");
  });

  it("a hidden your-move lights, then calms the moment the session is viewed", () => {
    const bg = sessionWithPane("/bg", "pane-bg");
    const fg = sessionWithPane("/fg", "pane-fg");
    useSessionsStore.getState().activateSession(fg);

    applyAgentEvent(ev("pane-bg", "SessionStart"));
    applyAgentEvent(ev("pane-bg", "Stop"));
    expect(phase("pane-bg")).toBe("your-move");

    useSessionsStore.getState().activateSession(bg); // view it
    expect(phase("pane-bg")).toBe("idle"); // acknowledged — won't relight on switch-away
  });

  it("permission is NOT acknowledgeable by viewing — still blocked, still urgent", () => {
    const bg = sessionWithPane("/bg", "pane-bg");
    const fg = sessionWithPane("/fg", "pane-fg");
    useSessionsStore.getState().activateSession(fg);

    applyAgentEvent(ev("pane-bg", "SessionStart"));
    applyAgentEvent(ev("pane-bg", "UserPromptSubmit"));
    applyAgentEvent(ev("pane-bg", "Notification", { kind: "permission_prompt" }));
    expect(phase("pane-bg")).toBe("permission");

    useSessionsStore.getState().activateSession(bg); // viewing doesn't unblock it
    expect(phase("pane-bg")).toBe("permission");
  });
});

describe("agentTracker — permission exits on sustained output", () => {
  // Approving a permission prompt fires no hook event until the turn ends, so
  // sustained output is the exit: demote to working, never leave the urgent
  // ring lying for the rest of the turn.
  it("two chunks within the sustain window demote permission → working", () => {
    const bg = sessionWithPane("/bg", "pane-bg");
    const fg = sessionWithPane("/fg", "pane-fg");
    useSessionsStore.getState().activateSession(fg);

    applyAgentEvent(ev("pane-bg", "SessionStart"));
    applyAgentEvent(ev("pane-bg", "UserPromptSubmit"));
    applyAgentEvent(ev("pane-bg", "Notification", { kind: "permission_prompt" }));
    expect(working(bg)).toBe(false);

    streamOutput("pane-bg"); // the approved tool starts streaming
    expect(phase("pane-bg")).toBe("working");
    expect(working(bg)).toBe(true);

    // The exact events still own the pane: the turn's Stop lands normally.
    applyAgentEvent(ev("pane-bg", "Stop"));
    expect(phase("pane-bg")).toBe("your-move");
    expect(working(bg)).toBe(false);
  });

  it("an isolated chunk (idle repaint) does not unblock the ring", () => {
    const bg = sessionWithPane("/bg", "pane-bg");
    const fg = sessionWithPane("/fg", "pane-fg");
    useSessionsStore.getState().activateSession(fg);

    applyAgentEvent(ev("pane-bg", "SessionStart"));
    applyAgentEvent(ev("pane-bg", "Notification", { kind: "permission_prompt" }));

    noteOutput("pane-bg"); // one lonely repaint
    expect(phase("pane-bg")).toBe("permission");

    // Another lone chunk far outside the sustain window re-arms, nothing more.
    vi.advanceTimersByTime(3000);
    noteOutput("pane-bg");
    expect(phase("pane-bg")).toBe("permission");
    expect(working(bg)).toBe(false);
  });

  it("your-move panes ignore output entirely (no phantom working)", () => {
    const bg = sessionWithPane("/bg", "pane-bg");
    const fg = sessionWithPane("/fg", "pane-fg");
    useSessionsStore.getState().activateSession(fg);

    applyAgentEvent(ev("pane-bg", "SessionStart"));
    applyAgentEvent(ev("pane-bg", "Stop"));
    expect(phase("pane-bg")).toBe("your-move");

    streamOutput("pane-bg"); // scrollback echoes, repaints — not a turn
    expect(phase("pane-bg")).toBe("your-move");
    expect(working(bg)).toBe(false);
  });
});

describe("agentTracker — class-A ownership over cadence", () => {
  it("suppresses cadence while the agent lives, resumes it after SessionEnd", () => {
    const bg = sessionWithPane("/bg", "pane-bg");
    const fg = sessionWithPane("/fg", "pane-fg");
    useSessionsStore.getState().activateSession(fg);

    applyAgentEvent(ev("pane-bg", "SessionStart"));
    // Agent is idle; a burst of terminal repaints must NOT spin the ring.
    streamOutput("pane-bg");
    expect(working(bg)).toBe(false);

    // Only the agent's own turn signal makes it working.
    applyAgentEvent(ev("pane-bg", "UserPromptSubmit"));
    expect(working(bg)).toBe(true);
    applyAgentEvent(ev("pane-bg", "Stop"));
    expect(working(bg)).toBe(false);

    // Agent gone → cadence heuristic is authoritative again.
    applyAgentEvent(ev("pane-bg", "SessionEnd"));
    streamOutput("pane-bg");
    expect(working(bg)).toBe(true);
  });

  it("forgetPaneAgent drops agent state and hands the pane back to heuristics", () => {
    const bg = sessionWithPane("/bg", "pane-bg");
    const fg = sessionWithPane("/fg", "pane-fg");
    useSessionsStore.getState().activateSession(fg);

    applyAgentEvent(ev("pane-bg", "SessionStart"));
    applyAgentEvent(ev("pane-bg", "UserPromptSubmit"));
    expect(working(bg)).toBe(true);

    forgetPaneAgent("pane-bg");
    expect(phase("pane-bg")).toBeUndefined();
    expect(paneHasLiveAgent("pane-bg")).toBe(false);
    expect(working(bg)).toBe(false);
  });
});
