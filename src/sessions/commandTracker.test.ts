import { describe, expect, it, beforeEach } from "vitest";

import {
  handleOsc133,
  paneCommandState,
  paneIsIntegrated,
  onCommandEvent,
  forgetPaneCommandState,
  disposeCommandTracker,
  type CommandEvent,
} from "@/sessions/commandTracker";

describe("commandTracker — OSC 133 state machine", () => {
  let events: CommandEvent[];
  let unsub: () => void;

  beforeEach(() => {
    disposeCommandTracker();
    events = [];
    unsub = onCommandEvent((e) => events.push(e));
    return () => unsub();
  });

  it("a pane is not integrated until a 133 mark arrives", () => {
    expect(paneIsIntegrated("p1")).toBe(false);
    expect(paneCommandState("p1")).toBe("none");
    handleOsc133("p1", "A");
    expect(paneIsIntegrated("p1")).toBe(true);
    expect(paneCommandState("p1")).toBe("prompt");
    expect(events).toEqual([{ type: "integrated", paneId: "p1", exitCode: null }]);
  });

  it("B emits prompt-ready on every prompt (after integrated on the first)", () => {
    handleOsc133("p1", "B");
    expect(events).toEqual([
      { type: "integrated", paneId: "p1", exitCode: null },
      { type: "prompt-ready", paneId: "p1", exitCode: null },
    ]);
    expect(paneCommandState("p1")).toBe("prompt");
    events = [];
    handleOsc133("p1", "B");
    expect(events).toEqual([{ type: "prompt-ready", paneId: "p1", exitCode: null }]);
  });

  it("C marks the pane running and emits command-start", () => {
    handleOsc133("p1", "A");
    handleOsc133("p1", "B");
    events = [];
    handleOsc133("p1", "C");
    expect(paneCommandState("p1")).toBe("running");
    expect(events).toEqual([{ type: "command-start", paneId: "p1", exitCode: null }]);
  });

  it("D after a running command emits command-finished with the exit code", () => {
    handleOsc133("p1", "C");
    events = [];
    handleOsc133("p1", "D;1");
    expect(paneCommandState("p1")).toBe("prompt");
    expect(events).toEqual([{ type: "command-finished", paneId: "p1", exitCode: 1 }]);
  });

  it("the first synthetic D (no command ran) does NOT emit command-finished", () => {
    // The ps1 integration's first prompt sends D;0 before any command.
    handleOsc133("p1", "D;0");
    handleOsc133("p1", "A");
    expect(events.filter((e) => e.type === "command-finished")).toEqual([]);
    expect(paneCommandState("p1")).toBe("prompt");
  });

  it("D arriving from the prompt state (no C seen) still emits command-finished", () => {
    // PSReadLine can replace our ReadLine wrapper → commands run without a C
    // mark. The prompt cycle alone (… A B [command] D…) must still report.
    handleOsc133("p1", "D;0"); // synthetic first prompt — ignored
    handleOsc133("p1", "A");
    handleOsc133("p1", "B");
    events = [];
    handleOsc133("p1", "D;2");
    expect(events).toEqual([{ type: "command-finished", paneId: "p1", exitCode: 2 }]);
  });

  it("D without an exit code reports null", () => {
    handleOsc133("p1", "C");
    events = [];
    handleOsc133("p1", "D");
    expect(events[0]).toEqual({ type: "command-finished", paneId: "p1", exitCode: null });
  });

  it("forgetPaneCommandState resets integration", () => {
    handleOsc133("p1", "C");
    forgetPaneCommandState("p1");
    expect(paneIsIntegrated("p1")).toBe(false);
    expect(paneCommandState("p1")).toBe("none");
  });

  it("unknown sub-marks still count as proof of integration", () => {
    handleOsc133("p1", "P;k=v");
    expect(paneIsIntegrated("p1")).toBe(true);
  });
});
