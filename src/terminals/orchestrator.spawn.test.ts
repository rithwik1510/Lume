// Regression tests for the session-restore freeze (v0.1.0-beta.1) and its
// replacement: reviving a pane used to auto-type its remembered
// `startupCommand` into the freshly-spawned shell, which raced PSReadLine's
// init and froze the prompt. The rule now: NOTHING is typed on spawn or on
// raw output; the remembered command is injected exactly once, and only when
// the shell itself reports prompt-ready via OSC 133;B (armStartupAutorun).
// Shells that never emit 133 time out and revive to a plain prompt.

import { describe, it, expect, beforeEach, vi } from "vitest";

// Hoisted spies shared with the mock factories below.
const m = vi.hoisted(() => ({
  openPty: vi.fn(),
  writePty: vi.fn(),
  killPty: vi.fn(),
  capturedChannel: null as null | { onmessage: ((msg: unknown) => void) | null },
  capturedOnData: null as null | ((data: string) => void),
}));

vi.mock("@tauri-apps/plugin-log", () => ({
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  // Minimal Channel stand-in: just a settable onmessage. The orchestrator
  // assigns the handler and hands the instance to openPty; we fire it manually.
  Channel: class {
    onmessage: ((msg: unknown) => void) | null = null;
  },
}));

vi.mock("@/terminals/ptyClient", () => ({
  openPty: (args: { channel: { onmessage: ((msg: unknown) => void) | null } }) => {
    m.capturedChannel = args.channel;
    return m.openPty(args);
  },
  writePty: (paneId: string, data: string) => m.writePty(paneId, data),
  killPty: (paneId: string) => m.killPty(paneId),
  isAppError: () => false,
}));

vi.mock("@/terminals/registry", () => ({
  getOrCreateTerminal: () => ({ write: vi.fn() }),
  resetMouseModes: vi.fn(),
  writeToTerminal: vi.fn(),
  onTerminalData: (_paneId: string, cb: (data: string) => void) => {
    m.capturedOnData = cb;
    return { dispose: vi.fn() };
  },
  disposeTerminal: vi.fn(),
  fitTerminal: () => null,
}));

vi.mock("@/store/ptyStore", () => {
  const api = { addPane: vi.fn(), markActivity: vi.fn(), setStatus: vi.fn(), removePane: vi.fn() };
  return { usePtyStore: { getState: () => api } };
});

vi.mock("@/sessions/attentionTracker", () => ({
  noteOutput: vi.fn(),
  noteBell: vi.fn(),
  forgetPane: vi.fn(),
  disposeAttentionTracker: vi.fn(),
}));

vi.mock("@/lib/shellsClient", () => ({
  detectShells: vi.fn(async () => []),
  configIdMatchesShell: () => false,
}));

import { spawnPane, armStartupAutorun } from "@/terminals/orchestrator";
import { useSessionsStore, paneLaunchSpec } from "@/store/sessionsStore";
import { handleOsc133, disposeCommandTracker } from "@/sessions/commandTracker";
import type { Shell } from "@/types";

const rememberedCommand = (paneId: string) =>
  paneLaunchSpec(useSessionsStore.getState(), paneId)?.startupCommand;

const PWSH: Shell = { kind: "pwsh", path: "pwsh.exe" };

describe("spawnPane — remembered command is never auto-injected", () => {
  beforeEach(() => {
    m.openPty.mockReset().mockResolvedValue(undefined);
    m.writePty.mockReset().mockResolvedValue(undefined);
    m.killPty.mockReset().mockResolvedValue(undefined);
    m.capturedChannel = null;
    m.capturedOnData = null;
    useSessionsStore.getState().reset();
    disposeCommandTracker();
  });

  it("does NOT writePty the leaf's startupCommand when the shell's first output arrives", async () => {
    // Seed a session whose pane carries a remembered command (the freeze trigger).
    const id = useSessionsStore.getState().createSession("C:\\proj", "s");
    useSessionsStore.getState().setLayoutRoot(id, {
      type: "leaf",
      paneId: "pane-7",
      shell: PWSH,
      startupCommand: "claude update",
    });

    await spawnPane("pane-7", PWSH);

    // Simulate the shell's first output byte (its prompt).
    expect(m.capturedChannel).not.toBeNull();
    m.capturedChannel!.onmessage?.(new ArrayBuffer(8));

    // The remembered command must NOT have been typed into the PTY.
    expect(m.writePty).not.toHaveBeenCalled();
  });

  it("still forwards real user keystrokes to the PTY", async () => {
    const id = useSessionsStore.getState().createSession("C:\\proj", "s");
    useSessionsStore.getState().setLayoutRoot(id, {
      type: "leaf",
      paneId: "pane-7",
      shell: PWSH,
      startupCommand: "claude update",
    });

    await spawnPane("pane-7", PWSH);

    // A real keystroke flows through the registered onData wire.
    expect(m.capturedOnData).not.toBeNull();
    m.capturedOnData!("x");

    expect(m.writePty).toHaveBeenCalledWith("pane-7", "x");
  });
});

describe("command memory — latest command typed at a prompt wins", () => {
  beforeEach(() => {
    m.writePty.mockReset().mockResolvedValue(undefined);
    disposeCommandTracker();
  });

  it("each command typed at an integrated prompt replaces the previous memory", async () => {
    const id = useSessionsStore.getState().createSession("C:\\proj", "s");
    useSessionsStore.getState().setLayoutRoot(id, { type: "leaf", paneId: "pane-7", shell: PWSH });
    await spawnPane("pane-7", PWSH);

    handleOsc133("pane-7", "B"); // shell at its prompt
    m.capturedOnData!("git status\r");
    expect(rememberedCommand("pane-7")).toBe("git status");

    m.capturedOnData!("claude\r"); // next prompt line — most recent wins
    expect(rememberedCommand("pane-7")).toBe("claude");
  });

  it("keystrokes typed INTO a running command never overwrite the memory", async () => {
    const id = useSessionsStore.getState().createSession("C:\\proj", "s");
    useSessionsStore.getState().setLayoutRoot(id, { type: "leaf", paneId: "pane-7", shell: PWSH });
    await spawnPane("pane-7", PWSH);

    handleOsc133("pane-7", "B");
    m.capturedOnData!("claude\r");
    expect(rememberedCommand("pane-7")).toBe("claude");

    handleOsc133("pane-7", "C"); // claude is running
    m.capturedOnData!("yes please refactor it\r"); // answer to the agent
    expect(rememberedCommand("pane-7")).toBe("claude");
  });

  it("non-integrated pane (no 133): single-shot first command, revive memory untouched", async () => {
    const id = useSessionsStore.getState().createSession("C:\\proj", "s");
    useSessionsStore.getState().setLayoutRoot(id, {
      type: "leaf",
      paneId: "pane-7",
      shell: PWSH,
      startupCommand: "claude", // revived pane already carries memory
    });
    await spawnPane("pane-7", PWSH);

    // No 133 marks ever (cmd/WSL): typing must NOT overwrite the memory.
    m.capturedOnData!("dir\r");
    expect(rememberedCommand("pane-7")).toBe("claude");
  });
});

describe("armStartupAutorun — remembered command runs at prompt-ready", () => {
  beforeEach(() => {
    m.writePty.mockReset().mockResolvedValue(undefined);
    disposeCommandTracker();
  });

  it("types the command exactly once, at the first 133;B, never on raw output", async () => {
    const id = useSessionsStore.getState().createSession("C:\\proj", "s");
    useSessionsStore.getState().setLayoutRoot(id, {
      type: "leaf",
      paneId: "pane-8",
      shell: PWSH,
      startupCommand: "claude",
    });
    await spawnPane("pane-8", PWSH);
    armStartupAutorun("pane-8", "claude");

    // Raw output (profile banner etc.) must not trigger anything.
    m.capturedChannel!.onmessage?.(new ArrayBuffer(8));
    expect(m.writePty).not.toHaveBeenCalled();

    // Shell reports prompt-ready → the command is typed with Enter.
    handleOsc133("pane-8", "B");
    expect(m.writePty).toHaveBeenCalledTimes(1);
    expect(m.writePty).toHaveBeenCalledWith("pane-8", "claude\r");

    // Later prompts must NOT re-run it (one-shot).
    m.writePty.mockClear();
    handleOsc133("pane-8", "B");
    expect(m.writePty).not.toHaveBeenCalled();
  });

  it("a prompt-ready from a DIFFERENT pane does not trigger the autorun", () => {
    armStartupAutorun("pane-8", "claude");
    handleOsc133("pane-99", "B");
    expect(m.writePty).not.toHaveBeenCalled();
    handleOsc133("pane-8", "B"); // fire it so no armed listener leaks
  });

  it("gives up after the timeout when the shell never speaks 133", () => {
    vi.useFakeTimers();
    try {
      armStartupAutorun("pane-8", "claude");
      vi.advanceTimersByTime(20_001);
      handleOsc133("pane-8", "B"); // too late — listener already reaped
      expect(m.writePty).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-arming replaces the previous autorun instead of double-typing", () => {
    armStartupAutorun("pane-8", "old command");
    armStartupAutorun("pane-8", "claude");
    handleOsc133("pane-8", "B");
    expect(m.writePty).toHaveBeenCalledTimes(1);
    expect(m.writePty).toHaveBeenCalledWith("pane-8", "claude\r");
  });
});
