// Regression test for the session-restore freeze (v0.1.0-beta.1):
// reviving a pane used to auto-type its remembered `startupCommand` into the
// freshly-spawned shell, which raced PSReadLine's init and froze the prompt.
// The command must still be REMEMBERED on the leaf, but never injected into the
// PTY on spawn. Only real user keystrokes may reach writePty.

import { describe, it, expect, beforeEach, vi } from "vitest";

// Hoisted spies shared with the mock factories below.
const m = vi.hoisted(() => ({
  openPty: vi.fn(),
  writePty: vi.fn(),
  killPty: vi.fn(),
  capturedChannel: null as null | { onmessage: ((msg: unknown) => void) | null },
  capturedOnData: null as null | ((data: string) => void),
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
  disposeAttentionTracker: vi.fn(),
}));

vi.mock("@/lib/shellsClient", () => ({
  detectShells: vi.fn(async () => []),
  configIdMatchesShell: () => false,
}));

import { spawnPane } from "@/terminals/orchestrator";
import { useSessionsStore } from "@/store/sessionsStore";
import type { Shell } from "@/types";

const PWSH: Shell = { kind: "pwsh", path: "pwsh.exe" };

describe("spawnPane — remembered command is never auto-injected", () => {
  beforeEach(() => {
    m.openPty.mockReset().mockResolvedValue(undefined);
    m.writePty.mockReset().mockResolvedValue(undefined);
    m.killPty.mockReset().mockResolvedValue(undefined);
    m.capturedChannel = null;
    m.capturedOnData = null;
    useSessionsStore.getState().reset();
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
