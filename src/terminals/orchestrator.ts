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

import {
  useSessionsStore,
  getActivePaneIds,
  findSessionForPane,
  paneLaunchSpec,
} from "@/store/sessionsStore";
import { usePtyStore } from "@/store/ptyStore";
import { makeCommandCapture } from "@/lib/commandCapture";
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

export async function spawnPane(
  paneId: PaneId,
  shell: Shell,
  opts?: { prefill?: string }
): Promise<void> {
  // Idempotency: if a runtime already exists for this pane (changeShell, or the
  // boot sweep), dispose its input wire before creating a new one. Otherwise two
  // onData handlers attach to the same Terminal and every keystroke double-sends.
  const prevRuntime = runtimes.get(paneId);
  if (prevRuntime) {
    prevRuntime.inputDisposer.dispose();
    runtimes.delete(paneId);
  }

  // Resolve the owning session's folder so the shell starts there instead of
  // the app's cwd. By the time the orchestrator fires spawnPane, the paneId is
  // already a leaf in some active session's layoutRoot, so findSessionForPane
  // resolves it. undefined → Rust inherits the default cwd. A stale/deleted
  // path is ignored server-side (pty_open guards on is_dir).
  const session = findSessionForPane(useSessionsStore.getState(), paneId);
  const cwd = session?.folderPath;
  // Diagnostic: shows in DevTools what folder we resolved for this pane.
  console.info(`[pty] spawn ${paneId} cwd=${cwd ?? "(none)"}`);

  // Remember the resolved shell on the pane's layout leaf so a reopened session
  // revives with the real shell instead of the global default (feature B).
  if (session) useSessionsStore.getState().setPaneShell(session.id, paneId, shell);

  // 1. Create/get the Terminal in the registry. Doesn't open into a DOM
  //    container yet — the TerminalPane component handles attach().
  const term = getOrCreateTerminal(paneId);

  // 2. Defensive: clear any leftover mouse modes from a prior session.
  resetMouseModes(paneId);

  // First-command capture (feature B): on a FRESH pane (no command remembered
  // yet) we reconstruct the first line the user submits and store it on the
  // leaf, so a later reopen can pre-fill it. Skipped on revive (the pane
  // already carries a command — we don't want to overwrite it).
  const capture = paneLaunchSpec(useSessionsStore.getState(), paneId)?.startupCommand
    ? null
    : makeCommandCapture();

  // 3. Register the input wire BEFORE opening the PTY. If the user is fast
  //    enough to type before pty_open resolves we just enqueue invokes.
  const inputDisposer = onTerminalData(paneId, (data) => {
    if (capture) {
      const cmd = capture.feed(data);
      if (cmd) {
        const sid = findSessionForPane(useSessionsStore.getState(), paneId)?.id;
        if (sid) useSessionsStore.getState().setPaneStartupCommand(sid, paneId, cmd);
      }
    }
    void writePty(paneId, data).catch((e) => {
      const msg = isAppError(e) ? formatAppError(e) : String(e);
      term.write(`\r\n\x1b[31m[pty_write failed: ${msg}]\x1b[0m\r\n`);
    });
  });
  runtimes.set(paneId, { inputDisposer });

  // 4. Pre-allocate the metadata record so the UI can render the pane shell
  //    while the spawn races.
  usePtyStore.getState().addPane(paneId, shell);

  // Pre-fill the remembered command (feature B revive). We wait for the shell's
  // first output (its prompt) before typing it, and do NOT send a newline — the
  // user presses Enter to resume, so we never silently start an agent turn.
  let prefillPending = opts?.prefill?.trim() || null;

  // 5. Open the PTY. The Channel is created here and wires Rust → xterm.
  //    Terminal data arrives as raw bytes (InvokeResponseBody::Raw → an
  //    ArrayBuffer) — NEVER JSON (DESIGN.md §4). Exit/Error control events
  //    still arrive as parsed JSON objects.
  const channel = new Channel<ArrayBuffer | PtyEvent>();
  channel.onmessage = (msg) => {
    // Terminal data arrives as raw bytes (InvokeResponseBody::Raw) — no JSON.
    if (msg instanceof ArrayBuffer || ArrayBuffer.isView(msg)) {
      const bytes =
        msg instanceof ArrayBuffer
          ? new Uint8Array(msg)
          : new Uint8Array(
              (msg as ArrayBufferView).buffer,
              (msg as ArrayBufferView).byteOffset,
              (msg as ArrayBufferView).byteLength
            );
      // PTY bytes NEVER touch Zustand. Direct to xterm.
      writeToTerminal(paneId, bytes);
      // Cheap throttled metadata bump for the UI's "active pane" indicator.
      usePtyStore.getState().markActivity(paneId);
      // Feed the attention tracker: a background session that produces output
      // then goes quiet glows its sidebar dot ("finished a turn / needs you").
      noteOutput(paneId);
      // First prompt is up — drop the remembered command at the prompt (no CR).
      if (prefillPending) {
        const text = prefillPending;
        prefillPending = null;
        void writePty(paneId, text).catch(() => undefined);
      }
      return;
    }
    // Control events (Exit/Error) arrive as parsed JSON objects.
    const evt = msg as PtyEvent;
    if (evt.kind === "exit") {
      usePtyStore.getState().setStatus(paneId, "exited");
      term.write(`\r\n\x1b[33m[pty exited code=${evt.code ?? "?"}]\x1b[0m\r\n`);
    } else if (evt.kind === "error") {
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
 * Spawn a pane from its persisted launch memory: the shell it last ran (or the
 * default if none recorded) and, on revive, the remembered first command
 * pre-filled at the prompt. Used both for the install-time sweep and for live
 * session activation (feature A/B — session restore).
 */
function reviveSpawn(paneId: PaneId): void {
  const spec = paneLaunchSpec(useSessionsStore.getState(), paneId);
  void spawnPane(paneId, spec?.shell ?? defaultShell(), { prefill: spec?.startupCommand });
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
      reviveSpawn(id);
    })();
  }

  const sub = useSessionsStore.subscribe((state, prev) => {
    const curr = getActivePaneIds(state);
    const before = getActivePaneIds(prev);
    const added = curr.filter((id) => !before.includes(id));
    const removed = before.filter((id) => !curr.includes(id));
    for (const id of added) reviveSpawn(id);
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
