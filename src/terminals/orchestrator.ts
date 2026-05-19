// PTY orchestrator — drives PTY lifecycle from layoutStore changes.
// Per DESIGN.md §4 rule #2 + Weekend 0 addendum: lifecycle is keyed by
// paneId, NOT by React mount/unmount. This module is the single source.
//
// Flow:
//   layoutStore.paneIds changes
//     → orchestrator notices added/removed ids
//     → calls openPty / killPty
//     → wires the per-pane Channel into:
//          - registry.writeToTerminal(bytes) for Data events
//          - ptyStore.markActivity(paneId) for throttled metadata
//          - ptyStore.setStatus(paneId, "exited"|"errored", ...) for lifecycle
//
// PTY event listeners register once at app mount (rule #9): the listener
// is the per-pane Channel.onmessage handler, set up at openPty time.

import { Channel } from "@tauri-apps/api/core";

import { useLayoutStore } from "@/store/layoutStore";
import { usePtyStore } from "@/store/ptyStore";
import {
  getOrCreateTerminal,
  resetMouseModes,
  writeToTerminal,
  onTerminalData,
  disposeTerminal,
  fitTerminal,
} from "@/terminals/registry";
import { openPty, writePty, killPty, isAppError } from "@/terminals/ptyClient";
import { formatAppError, type PaneId, type PtyEvent, type Shell } from "@/types";

interface PaneRuntime {
  /** Disposer for the xterm onData handler — closes the JS→PTY input wire. */
  inputDisposer: { dispose(): void };
}

const runtimes = new Map<PaneId, PaneRuntime>();

/** Default shell for Weekend 1 (parameterised in Weekend 3 via config). */
function defaultShell(): Shell {
  return { kind: "wsl", distro: "Ubuntu" };
}

async function spawnPane(paneId: PaneId, shell: Shell): Promise<void> {
  // 1. Create/get the Terminal in the registry. Doesn't open into a DOM
  //    container yet — the TerminalPane component handles attach().
  const term = getOrCreateTerminal(paneId);

  // 2. Defensive: clear any leftover mouse modes from a prior session.
  resetMouseModes(paneId);

  // 3. Register the input wire BEFORE opening the PTY. If the user is fast
  //    enough to type before pty_open resolves we just enqueue invokes.
  const inputDisposer = onTerminalData(paneId, (data) => {
    void writePty(paneId, data).catch((e) => {
      const msg = isAppError(e) ? formatAppError(e) : String(e);
      term.write(`\r\n\x1b[31m[pty_write failed: ${msg}]\x1b[0m\r\n`);
    });
  });
  runtimes.set(paneId, { inputDisposer });

  // 4. Pre-allocate the metadata record so the UI can render the pane shell
  //    while the spawn races.
  usePtyStore.getState().addPane(paneId, shell);

  // 5. Open the PTY. The Channel is created here and wires Rust → xterm.
  const channel = new Channel<PtyEvent>();
  channel.onmessage = (evt) => {
    if (evt.kind === "data") {
      // PTY bytes NEVER touch Zustand. Direct to xterm.
      writeToTerminal(paneId, new Uint8Array(evt.bytes));
      // Cheap throttled metadata bump for the UI's "active pane" indicator.
      usePtyStore.getState().markActivity(paneId);
    } else if (evt.kind === "exit") {
      usePtyStore.getState().setStatus(paneId, "exited");
      term.write(`\r\n\x1b[33m[pty exited code=${evt.code ?? "?"}]\x1b[0m\r\n`);
    } else {
      usePtyStore
        .getState()
        .setStatus(paneId, "errored", formatAppError(evt.error));
      term.write(
        `\r\n\x1b[31m[pty error: ${formatAppError(evt.error)}]\x1b[0m\r\n`
      );
    }
  };

  // Best-effort sizing. The TerminalPane's ResizeObserver will refine this
  // moments later. We pass plausible defaults so the spawned shell isn't
  // born into a 1×1 grid.
  const sizing = fitTerminal(paneId) ?? { cols: 80, rows: 24 };

  try {
    await openPty({ paneId, shell, cols: sizing.cols, rows: sizing.rows, channel });
    usePtyStore.getState().setStatus(paneId, "running");
  } catch (e) {
    const msg = isAppError(e) ? formatAppError(e) : String(e);
    usePtyStore.getState().setStatus(paneId, "errored", msg);
    term.write(`\r\n\x1b[31m[pty_open failed: ${msg}]\x1b[0m\r\n`);
  }
}

async function killPane(paneId: PaneId): Promise<void> {
  // 1. Tell Rust to teardown.
  try {
    await killPty(paneId);
  } catch {
    // Already dead is fine.
  }
  // 2. Pull the input wire.
  runtimes.get(paneId)?.inputDisposer.dispose();
  runtimes.delete(paneId);
  // 3. Drop the Terminal + metadata.
  disposeTerminal(paneId);
  usePtyStore.getState().removePane(paneId);
}

/**
 * Install the orchestrator at app boot. Call ONCE from App.tsx. Returns an
 * unsubscriber for tests / hot reload.
 */
export function installPtyOrchestrator(): () => void {
  const sub = useLayoutStore.subscribe((state, prev) => {
    const added = state.paneIds.filter((id) => !prev.paneIds.includes(id));
    const removed = prev.paneIds.filter((id) => !state.paneIds.includes(id));
    for (const id of added) void spawnPane(id, defaultShell());
    for (const id of removed) void killPane(id);
  });
  return sub;
}
