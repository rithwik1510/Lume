// PTY orchestrator — drives PTY lifecycle from sessionsStore changes.
// Per DESIGN.md §4 rule #2 + Weekend 0 addendum: lifecycle is keyed by
// paneId, NOT by React mount/unmount. This module is the single source.
//
// Flow (session-manager-aware as of Phase 1):
//   sessionsStore active-session set changes (status flips or layout edits)
//     → getActivePaneIds(state) gives the union of paneIds across every
//       session with status === "active"
//     → orchestrator diffs added/removed ids against the previous union
//     → calls openPty / killPty
//     → wires the per-pane Channel into:
//          - registry.writeToTerminal(bytes) for Data events
//          - ptyStore.markActivity(paneId) for throttled metadata
//          - ptyStore.setStatus(paneId, "exited"|"errored", ...) for lifecycle
//
// PTY event listeners register once at app mount (rule #9): the listener
// is the per-pane Channel.onmessage handler, set up at openPty time.

import { Channel } from "@tauri-apps/api/core";

import { useSessionsStore, getActivePaneIds, findSessionForPane } from "@/store/sessionsStore";
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
import { detectShells, configIdMatchesShell } from "@/lib/shellsClient";
import { noteOutput, disposeAttentionTracker } from "@/sessions/attentionTracker";
import { useSettingsStore } from "@/store/settingsStore";
import { formatAppError, type PaneId, type PtyEvent, type Shell } from "@/types";

/**
 * Module-level cache of shells discovered at boot. Populated by the
 * `detectShells` call kicked off inside `installPtyOrchestrator`. Empty until
 * the promise resolves; the right-click menu will simply have no shell options
 * until then. See DESIGN.md §12 W3 #8.
 */
let detectedShells: Shell[] = [];

export function getDetectedShells(): Shell[] {
  return detectedShells;
}

export async function changeShell(paneId: PaneId, shell: Shell): Promise<void> {
  // Tear down existing PTY then re-spawn with the new shell. The xterm
  // Terminal stays alive in the registry (so scrollback is preserved
  // through the swap — the new PTY's first bytes append after the old
  // content). Caller is responsible for not interleaving shell swaps
  // for the same paneId.
  await killPty(paneId).catch(() => undefined);
  await spawnPane(paneId, shell);
}

interface PaneRuntime {
  /** Disposer for the xterm onData handler — closes the JS→PTY input wire. */
  inputDisposer: { dispose(): void };
}

const runtimes = new Map<PaneId, PaneRuntime>();

/**
 * Default shell for a freshly-spawned pane. Prefers the shell configured
 * in config.toml's `default_shell` key, matched against the detected shells.
 * Falls back to Windows PowerShell if the configured shell isn't detected
 * or detection hasn't completed yet.
 */
function defaultShell(): Shell {
  const configured = useSettingsStore.getState().config.default_shell;
  const match = detectedShells.find((s) => configIdMatchesShell(configured, s));
  if (match) return match;
  // Fallback: Windows PowerShell — universally available on Windows.
  return { kind: "powershell", path: "powershell.exe" };
}

export async function spawnPane(paneId: PaneId, shell: Shell): Promise<void> {
  // Resolve the owning session's folder so the shell starts there instead of
  // the app's cwd. By the time the orchestrator fires spawnPane, the paneId is
  // already a leaf in some active session's layoutRoot, so findSessionForPane
  // resolves it. undefined → Rust inherits the default cwd. A stale/deleted
  // path is ignored server-side (pty_open guards on is_dir).
  const cwd = findSessionForPane(useSessionsStore.getState(), paneId)?.folderPath;
  // Diagnostic: shows in DevTools what folder we resolved for this pane.
  console.info(`[pty] spawn ${paneId} cwd=${cwd ?? "(none)"}`);

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
      // Feed the attention tracker: a background session that produces output
      // then goes quiet glows its sidebar dot ("finished a turn / needs you").
      noteOutput(paneId);
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
    await openPty({ paneId, shell, cols: sizing.cols, rows: sizing.rows, cwd, channel });
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
 *
 * Robustness:
 *   - On install, walk every existing leaf in the layout. If a leaf has no
 *     PaneRuntime entry (channel handler), tear down anything stale and
 *     re-spawn. This makes HMR safe: the OLD orchestrator's channel
 *     handlers get GC'd when its closures are dropped, but the Rust-side
 *     PTYs and xterm instances persist. Without this re-spawn, bytes would
 *     flow from Rust to nowhere and panes would render blank.
 *   - On subscription, diff added/removed paneIds across state transitions.
 */
export function installPtyOrchestrator(): () => void {
  // Cover panes that already exist before we subscribed (HMR / cold-start
  // race where the layout was populated before this listener was attached).
  // killPane is a no-op for ids it doesn't recognise on the Rust side.
  //
  // We also dispose the existing xterm Terminal so the next spawn creates
  // a fresh one. Without this, an already-corrupted Terminal (e.g. one
  // that ended up in the open()-called-twice state during a prior buggy
  // build) would persist and the new spawn's bytes would render nowhere.
  // Scrollback is lost — acceptable cost for HMR/recovery scenarios.
  const initial = getActivePaneIds(useSessionsStore.getState());
  for (const id of initial) {
    void (async () => {
      try {
        await killPty(id);
      } catch {
        // ignore — pane may not exist on the Rust side yet
      }
      runtimes.get(id)?.inputDisposer.dispose();
      runtimes.delete(id);
      disposeTerminal(id);
      void spawnPane(id, defaultShell());
    })();
  }

  const sub = useSessionsStore.subscribe((state, prev) => {
    const curr = getActivePaneIds(state);
    const before = getActivePaneIds(prev);
    const added = curr.filter((id) => !before.includes(id));
    const removed = before.filter((id) => !curr.includes(id));
    for (const id of added) void spawnPane(id, defaultShell());
    for (const id of removed) void killPane(id);
  });

  // Boot-time shell auto-detection. Fire-and-forget — the right-click menu
  // reads from `detectedShells` and renders an empty submenu until this
  // resolves. Failure (e.g. detect_shells returns no shells on this host) is
  // logged but non-fatal; users can keep using the default shell.
  void detectShells()
    .then((shells) => {
      detectedShells = shells;
    })
    .catch((err) => {
      console.error("detectShells failed", err);
    });

  return () => {
    sub();
    disposeAttentionTracker();
  };
}
