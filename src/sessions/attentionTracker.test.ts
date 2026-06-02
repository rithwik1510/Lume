import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";

// sessionsStore pulls in the persist middleware (plugin-store) on import.
vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: vi.fn(async () => null),
    set: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  })),
}));

import { useSessionsStore } from "@/store/sessionsStore";
import { leaf } from "@/store/layout/tree";
import {
  noteOutput,
  noteBell,
  disposeAttentionTracker,
} from "@/sessions/attentionTracker";

const IDLE_MS = 2000;

function sessionWithPane(folder: string, paneId: string): string {
  const s = useSessionsStore.getState();
  const id = s.createSession(folder);
  s.setLayoutRoot(id, leaf(paneId));
  return id;
}

const unread = (id: string) => useSessionsStore.getState().sessions[id].unread;
const working = (id: string) => useSessionsStore.getState().sessions[id].working;

describe("attentionTracker", () => {
  beforeEach(() => {
    // Fresh store; clear any pending timers from a prior test.
    useSessionsStore.setState(useSessionsStore.getInitialState(), true);
    disposeAttentionTracker();
    vi.useFakeTimers();
  });
  afterEach(() => {
    disposeAttentionTracker();
    vi.useRealTimers();
  });

  it("glows a background session's dot once it goes idle after output", () => {
    const bg = sessionWithPane("/bg", "pane-bg");
    const fg = sessionWithPane("/fg", "pane-fg");
    useSessionsStore.getState().activateSession(fg); // fg is the visible one

    noteOutput("pane-bg");
    expect(unread(bg)).toBe(false); // still "working" — timer pending
    expect(working(bg)).toBe(true); // green pulse while streaming
    vi.advanceTimersByTime(IDLE_MS);
    expect(unread(bg)).toBe(true); // quiet long enough → finished a turn
    expect(working(bg)).toBe(false); // amber supersedes green
  });

  it("never glows the visible (active) session", () => {
    const fg = sessionWithPane("/fg", "pane-fg");
    useSessionsStore.getState().activateSession(fg);

    noteOutput("pane-fg");
    vi.advanceTimersByTime(IDLE_MS);
    expect(unread(fg)).toBe(false);
  });

  it("continuous output keeps resetting the idle timer (no premature glow)", () => {
    const bg = sessionWithPane("/bg", "pane-bg");
    const fg = sessionWithPane("/fg", "pane-fg");
    useSessionsStore.getState().activateSession(fg);

    noteOutput("pane-bg");
    vi.advanceTimersByTime(IDLE_MS - 500);
    noteOutput("pane-bg"); // more output → re-arm
    vi.advanceTimersByTime(IDLE_MS - 500);
    expect(unread(bg)).toBe(false); // only 1500ms since last output
    vi.advanceTimersByTime(500);
    expect(unread(bg)).toBe(true); // now quiet for the full window
  });

  it("a bell glows a background session immediately", () => {
    const bg = sessionWithPane("/bg", "pane-bg");
    const fg = sessionWithPane("/fg", "pane-fg");
    useSessionsStore.getState().activateSession(fg);

    noteBell("pane-bg");
    expect(unread(bg)).toBe(true); // no timer — bell is an explicit cue
  });

  it("a bell on the visible session does not glow", () => {
    const fg = sessionWithPane("/fg", "pane-fg");
    useSessionsStore.getState().activateSession(fg);

    noteBell("pane-fg");
    expect(unread(fg)).toBe(false);
  });

  it("new output on an already-unread session flips amber back to green", () => {
    const bg = sessionWithPane("/bg", "pane-bg");
    const fg = sessionWithPane("/fg", "pane-fg");
    useSessionsStore.getState().activateSession(fg);

    // Drive the bg session to amber (idle-after-output).
    noteOutput("pane-bg");
    vi.advanceTimersByTime(IDLE_MS);
    expect(unread(bg)).toBe(true);
    expect(working(bg)).toBe(false);

    // Agent starts a new turn — fresh output should green-pulse, not stay amber.
    noteOutput("pane-bg");
    expect(working(bg)).toBe(true);
    expect(unread(bg)).toBe(false);
  });

  it("a bell cancels the pending idle timer (no late re-glow)", () => {
    const bg = sessionWithPane("/bg", "pane-bg");
    const fg = sessionWithPane("/fg", "pane-fg");
    useSessionsStore.getState().activateSession(fg);

    noteOutput("pane-bg"); // working + idle timer armed
    noteBell("pane-bg"); // explicit "done" — should consume the cue
    expect(unread(bg)).toBe(true);
    expect(working(bg)).toBe(false);

    // User dismisses, then waits past the original idle window. The cancelled
    // timer must NOT fire and re-set unread.
    useSessionsStore.getState().clearUnread(bg);
    vi.advanceTimersByTime(IDLE_MS * 2);
    expect(unread(bg)).toBe(false);
  });
});
