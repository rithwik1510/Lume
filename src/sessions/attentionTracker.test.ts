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
import { leaf, split } from "@/store/layout/tree";
import {
  noteOutput,
  noteBell,
  muteOutput,
  forgetPane,
  disposeAttentionTracker,
  QUIET_MS,
} from "@/sessions/attentionTracker";
import { handleOsc133, disposeCommandTracker } from "@/sessions/commandTracker";

function sessionWithPane(folder: string, paneId: string): string {
  const s = useSessionsStore.getState();
  const id = s.createSession(folder);
  s.setLayoutRoot(id, leaf(paneId));
  return id;
}

const unread = (id: string) => useSessionsStore.getState().sessions[id].unread;
const working = (id: string) => useSessionsStore.getState().sessions[id].working;

beforeEach(() => {
  useSessionsStore.setState(useSessionsStore.getInitialState(), true);
  disposeAttentionTracker();
  disposeCommandTracker();
  vi.useFakeTimers();
});
afterEach(() => {
  disposeAttentionTracker();
  disposeCommandTracker();
  vi.useRealTimers();
});

describe("attentionTracker — cadence fallback (non-integrated panes)", () => {
  it("output marks the session working; quiet flips it to a dot", () => {
    const bg = sessionWithPane("/bg", "pane-bg");
    const fg = sessionWithPane("/fg", "pane-fg");
    useSessionsStore.getState().activateSession(fg); // fg is the visible one

    noteOutput("pane-bg");
    expect(working(bg)).toBe(true); // streaming → spinner
    expect(unread(bg)).toBe(false); // no dot while streaming
    vi.advanceTimersByTime(QUIET_MS);
    expect(working(bg)).toBe(false); // quiet → done working
    expect(unread(bg)).toBe(true); // quiet long enough → finished a turn
  });

  it("continuous output keeps resetting the quiet timer (no premature dot)", () => {
    const bg = sessionWithPane("/bg", "pane-bg");
    const fg = sessionWithPane("/fg", "pane-fg");
    useSessionsStore.getState().activateSession(fg);

    noteOutput("pane-bg");
    vi.advanceTimersByTime(QUIET_MS - 500);
    noteOutput("pane-bg"); // a mid-task heartbeat re-arms the window
    vi.advanceTimersByTime(QUIET_MS - 500);
    expect(unread(bg)).toBe(false); // not quiet for the full window yet
    vi.advanceTimersByTime(500);
    expect(unread(bg)).toBe(true);
  });

  it("never lights the visible (active) session — but does show it working", () => {
    const fg = sessionWithPane("/fg", "pane-fg");
    useSessionsStore.getState().activateSession(fg);

    noteOutput("pane-fg");
    expect(working(fg)).toBe(true); // the spinner is a fact, not a beg
    vi.advanceTimersByTime(QUIET_MS);
    expect(unread(fg)).toBe(false);
  });

  it("new output clears a stale dot (agent resumed → self-correcting)", () => {
    const bg = sessionWithPane("/bg", "pane-bg");
    const fg = sessionWithPane("/fg", "pane-fg");
    useSessionsStore.getState().activateSession(fg);

    noteOutput("pane-bg");
    vi.advanceTimersByTime(QUIET_MS);
    expect(unread(bg)).toBe(true);

    noteOutput("pane-bg"); // working again
    expect(unread(bg)).toBe(false);
    expect(working(bg)).toBe(true);
  });

  it("any terminal in a session lights the one session (OR across panes)", () => {
    const s = useSessionsStore.getState();
    const id = s.createSession("/multi");
    s.setLayoutRoot(id, split("horizontal", 0.5, leaf("pane-a"), leaf("pane-b")));
    const fg = sessionWithPane("/fg", "pane-fg");
    useSessionsStore.getState().activateSession(fg);

    noteOutput("pane-b"); // output in the second pane only
    expect(working(id)).toBe(true);
    vi.advanceTimersByTime(QUIET_MS);
    expect(unread(id)).toBe(true);
  });

  it("a signal from a pane that belongs to no session is a no-op", () => {
    const bg = sessionWithPane("/bg", "pane-bg");
    const fg = sessionWithPane("/fg", "pane-fg");
    useSessionsStore.getState().activateSession(fg);

    noteBell("pane-orphan");
    noteOutput("pane-orphan");
    vi.advanceTimersByTime(QUIET_MS);
    expect(unread(bg)).toBe(false);
    expect(unread(fg)).toBe(false);
  });

  it("forgetPane clears the working flag (pane killed mid-stream)", () => {
    const bg = sessionWithPane("/bg", "pane-bg");
    const fg = sessionWithPane("/fg", "pane-fg");
    useSessionsStore.getState().activateSession(fg);

    noteOutput("pane-bg");
    expect(working(bg)).toBe(true);
    forgetPane("pane-bg");
    expect(working(bg)).toBe(false);
    vi.advanceTimersByTime(QUIET_MS);
    expect(unread(bg)).toBe(false); // its quiet timer died with it
  });
});

describe("attentionTracker — bell / agent notifications", () => {
  it("a bell lights the dot immediately, no waiting", () => {
    const bg = sessionWithPane("/bg", "pane-bg");
    const fg = sessionWithPane("/fg", "pane-fg");
    useSessionsStore.getState().activateSession(fg);

    noteBell("pane-bg");
    expect(unread(bg)).toBe(true);
  });

  it("a bell on the visible session does not light it", () => {
    const fg = sessionWithPane("/fg", "pane-fg");
    useSessionsStore.getState().activateSession(fg);

    noteBell("pane-fg");
    expect(unread(fg)).toBe(false);
  });
});

describe("attentionTracker — OSC 133 ground truth (integrated panes)", () => {
  it("agent inside a running command: stream = spinner, quiet = turn dot, resume = spinner again", () => {
    const bg = sessionWithPane("/bg", "pane-bg");
    const fg = sessionWithPane("/fg", "pane-fg");
    useSessionsStore.getState().activateSession(fg);

    handleOsc133("pane-bg", "C"); // `claude` starts
    expect(working(bg)).toBe(true);

    noteOutput("pane-bg"); // agent streaming
    vi.advanceTimersByTime(QUIET_MS - 500);
    expect(working(bg)).toBe(true);
    expect(unread(bg)).toBe(false); // still working — no dot

    vi.advanceTimersByTime(500); // …goes quiet: finished a turn / waiting
    expect(unread(bg)).toBe(true); // turn dot
    expect(working(bg)).toBe(false); // spinner yields to the dot

    noteOutput("pane-bg"); // user answered elsewhere / agent resumed
    expect(unread(bg)).toBe(false); // self-correcting
    expect(working(bg)).toBe(true); // spinner back
  });

  it("command finished in a background session → dot, working off", () => {
    const bg = sessionWithPane("/bg", "pane-bg");
    const fg = sessionWithPane("/fg", "pane-fg");
    useSessionsStore.getState().activateSession(fg);

    handleOsc133("pane-bg", "C");
    handleOsc133("pane-bg", "D;0");
    expect(working(bg)).toBe(false);
    expect(unread(bg)).toBe(true);
  });

  it("command finished while you're watching → no dot", () => {
    const fg = sessionWithPane("/fg", "pane-fg");
    useSessionsStore.getState().activateSession(fg);

    handleOsc133("pane-fg", "C");
    handleOsc133("pane-fg", "D;0");
    expect(unread(fg)).toBe(false);
    expect(working(fg)).toBe(false);
  });

  it("the first synthetic D (shell startup) never produces a dot", () => {
    const bg = sessionWithPane("/bg", "pane-bg");
    const fg = sessionWithPane("/fg", "pane-fg");
    useSessionsStore.getState().activateSession(fg);

    // ps1 integration's first prompt: D;0 then A then B, no command ran.
    handleOsc133("pane-bg", "D;0");
    handleOsc133("pane-bg", "A");
    handleOsc133("pane-bg", "B");
    expect(unread(bg)).toBe(false);
    expect(working(bg)).toBe(false);
  });

  it("a bell DURING a running command still lights the dot (agent asking)", () => {
    const bg = sessionWithPane("/bg", "pane-bg");
    const fg = sessionWithPane("/fg", "pane-fg");
    useSessionsStore.getState().activateSession(fg);

    handleOsc133("pane-bg", "C"); // agent running…
    noteBell("pane-bg"); // …and it rings: permission prompt / turn done
    expect(unread(bg)).toBe(true);
    expect(working(bg)).toBe(true); // still running — both signals true
  });

  it("starting a new command clears a stale dot", () => {
    const bg = sessionWithPane("/bg", "pane-bg");
    const fg = sessionWithPane("/fg", "pane-fg");
    useSessionsStore.getState().activateSession(fg);

    handleOsc133("pane-bg", "C");
    handleOsc133("pane-bg", "D;0"); // dot
    expect(unread(bg)).toBe(true);
    handleOsc133("pane-bg", "C"); // fresh command → stale dot dismissed
    expect(unread(bg)).toBe(false);
    expect(working(bg)).toBe(true);
  });

  it("multi-pane session: ANY pane's question/completion lands the dot, even while another pane still works", () => {
    // The strategy across N terminals in one session:
    //   working = OR over panes (any pane running → spinner)
    //   dot     = OR over panes (any pane finished / asked → unread)
    //   and the dot TRUMPS the spinner in the row (SessionRow renders unread
    //   first), so one agent needing you is never masked by another working.
    const s = useSessionsStore.getState();
    const id = s.createSession("/multi");
    s.setLayoutRoot(id, split("horizontal", 0.5, leaf("pane-a"), leaf("pane-b")));
    const fg = sessionWithPane("/fg", "pane-fg");
    useSessionsStore.getState().activateSession(fg);

    handleOsc133("pane-a", "C"); // agent A working
    handleOsc133("pane-b", "C"); // agent B working
    expect(working(id)).toBe(true);

    handleOsc133("pane-b", "D;0"); // agent B finishes while A keeps going
    expect(unread(id)).toBe(true); // dot lands immediately
    expect(working(id)).toBe(true); // A is still working — both facts held

    handleOsc133("pane-a", "D;0"); // A finishes too
    expect(working(id)).toBe(false);
    expect(unread(id)).toBe(true); // dot stays until the session is opened
  });

  it("multi-pane session: one agent asks a question (quiet) while another streams", () => {
    const s = useSessionsStore.getState();
    const id = s.createSession("/multi2");
    s.setLayoutRoot(id, split("horizontal", 0.5, leaf("pane-c"), leaf("pane-d")));
    const fg = sessionWithPane("/fg", "pane-fg");
    useSessionsStore.getState().activateSession(fg);

    handleOsc133("pane-c", "C");
    handleOsc133("pane-d", "C");
    noteOutput("pane-c"); // C streams…
    noteOutput("pane-d"); // …D streams, then goes quiet (asked a question)
    vi.advanceTimersByTime(QUIET_MS - 500);
    noteOutput("pane-c"); // C still streaming
    vi.advanceTimersByTime(500);

    expect(unread(id)).toBe(true); // D's question landed the dot
    expect(working(id)).toBe(true); // C still working — spinner fact retained
  });

  it("leaving an idle agent produces NO signals — switch noise is filtered", () => {
    // The reported bug: open claude, give it no prompt, switch away → the
    // switch itself makes the terminal repaint (focus-out redraw), which
    // read as activity → phantom spinner for ~4s, then a phantom dot.
    const a = sessionWithPane("/a", "pane-a");
    const b = sessionWithPane("/b", "pane-b");
    useSessionsStore.getState().activateSession(a);

    handleOsc133("pane-a", "C"); // user opened claude…
    noteOutput("pane-a"); // …its banner rendered…
    vi.advanceTimersByTime(QUIET_MS * 2); // …and it sat idle, no prompt given
    expect(unread(a)).toBe(false); // active session: quiet never dots

    useSessionsStore.getState().activateSession(b); // go check something else
    expect(working(a)).toBe(false); // slate wiped on deactivation
    noteOutput("pane-a"); // focus-out repaint noise from the switch
    vi.advanceTimersByTime(QUIET_MS * 3);
    expect(working(a)).toBe(false); // no phantom spinner
    expect(unread(a)).toBe(false); // no phantom dot — nothing happened there
  });

  it("a REAL background turn still signals after a switch — grace filters only echoes", () => {
    const a = sessionWithPane("/a", "pane-a");
    const b = sessionWithPane("/b", "pane-b");
    useSessionsStore.getState().activateSession(a);
    handleOsc133("pane-a", "C"); // agent given a task
    useSessionsStore.getState().activateSession(b); // switch away mid-work

    vi.advanceTimersByTime(2000); // past the grace window
    noteOutput("pane-a"); // agent genuinely streaming
    expect(working(a)).toBe(true); // spinner
    vi.advanceTimersByTime(QUIET_MS); // turn ends
    expect(unread(a)).toBe(true); // real dot
    expect(working(a)).toBe(false);
  });

  it("muteOutput swallows resize-repaint bytes", () => {
    const bg = sessionWithPane("/bg", "pane-bg");
    const fg = sessionWithPane("/fg", "pane-fg");
    useSessionsStore.getState().activateSession(fg);

    muteOutput("pane-bg");
    noteOutput("pane-bg"); // repaint right after a fit/resize
    expect(working(bg)).toBe(false);
    vi.advanceTimersByTime(1000); // mute expired
    noteOutput("pane-bg"); // real output
    expect(working(bg)).toBe(true);
  });

  it("integration arriving retires a pending cadence timer (no guessed dot)", () => {
    const bg = sessionWithPane("/bg", "pane-bg");
    const fg = sessionWithPane("/fg", "pane-fg");
    useSessionsStore.getState().activateSession(fg);

    // Shell banner output before the first integrated prompt rendered:
    noteOutput("pane-bg");
    expect(working(bg)).toBe(true);
    // …then the integration proves itself:
    handleOsc133("pane-bg", "D;0");
    handleOsc133("pane-bg", "A");
    expect(working(bg)).toBe(false); // at prompt, nothing running
    vi.advanceTimersByTime(QUIET_MS * 2);
    expect(unread(bg)).toBe(false); // the cadence guess was cancelled
  });

  it("output at an idle prompt is pure noise — no spinner, no timer, no dot", () => {
    // Prompt repaints, resize redraws, session-switch echo: with unscoped
    // cadence these spun the ring "randomly". Scoped, they do NOTHING.
    const bg = sessionWithPane("/bg", "pane-bg");
    const fg = sessionWithPane("/fg", "pane-fg");
    useSessionsStore.getState().activateSession(fg);

    handleOsc133("pane-bg", "A"); // integrated, sitting at prompt
    noteOutput("pane-bg"); // repaint noise
    expect(working(bg)).toBe(false);
    vi.advanceTimersByTime(QUIET_MS * 2);
    expect(working(bg)).toBe(false);
    expect(unread(bg)).toBe(false);
  });

  it("pwsh without a C mark: D after the prompt still lands the exact dot", () => {
    // Real-world failure this guards: PSReadLine replaced our ReadLine
    // wrapper, so commands emit no 133;C — only the prompt's D/A/B cycle.
    // No spinner without C (we can't know it started), but the dot is exact.
    const bg = sessionWithPane("/bg", "pane-bg");
    const fg = sessionWithPane("/fg", "pane-fg");
    useSessionsStore.getState().activateSession(fg);

    handleOsc133("pane-bg", "D;0"); // first synthetic prompt
    handleOsc133("pane-bg", "A");
    handleOsc133("pane-bg", "B");
    expect(unread(bg)).toBe(false);

    noteOutput("pane-bg"); // command output (state still "prompt" — no C)
    handleOsc133("pane-bg", "D;0"); // command finished → next prompt's D
    expect(unread(bg)).toBe(true); // exact dot
    expect(working(bg)).toBe(false);
  });
});
