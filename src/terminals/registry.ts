// Module-level registry of xterm.js Terminal instances, keyed by paneId.
// Per DESIGN.md §4 rule #2:
//   "xterm.js Terminal instances live in a module-level Map<paneId, Terminal>,
//    never in Zustand."
// And the Weekend-0 spike addendum:
//   "PTY lifecycle is keyed by paneId, NOT by React component mount/unmount."
//
// The registry is the single owner. Components ATTACH to a Terminal by
// calling `attach(paneId, hostEl)` — they don't create or destroy it.
// Lifecycle is driven by layoutStore subscription in the PTY orchestrator.

import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";

import type { PaneId } from "@/types";

interface TerminalEntry {
  term: Terminal;
  fit: FitAddon;
  webgl: WebglAddon | null;
  attachedTo: HTMLElement | null;
}

const entries = new Map<PaneId, TerminalEntry>();

/**
 * Escape sequence that turns off every xterm mouse-tracking mode we know of.
 * Used proactively on every PTY spawn (defensive against apps that exit dirty
 * and leave mouse-mode on — see Weekend 0 spike learning, DESIGN.md §7).
 */
export const MOUSE_MODE_RESET =
  "\x1b[?9l\x1b[?1000l\x1b[?1001l\x1b[?1002l\x1b[?1003l\x1b[?1004l\x1b[?1005l\x1b[?1006l\x1b[?1015l\x1b[?1016l";

/**
 * Get the Terminal for `paneId`, creating it on first access. The instance
 * persists across React mounts/unmounts of any pane component.
 */
export function getOrCreateTerminal(paneId: PaneId): Terminal {
  const existing = entries.get(paneId);
  if (existing) return existing.term;

  const term = new Terminal({
    fontFamily: '"JetBrains Mono", Consolas, "Courier New", monospace',
    fontSize: 14,
    lineHeight: 1.2,
    cursorBlink: true,
    cursorStyle: "block",
    theme: {
      background: "#0a0a0a",
      foreground: "#e8e8e8",
      cursor: "#d4a85c",
      selectionBackground: "#d4a85c33",
    },
    scrollback: 10000,
    allowProposedApi: true,
  });

  const fit = new FitAddon();
  term.loadAddon(fit);

  entries.set(paneId, { term, fit, webgl: null, attachedTo: null });
  return term;
}

/**
 * Attach a previously-created Terminal to a DOM container. Idempotent — calling
 * twice with the same element is a no-op; calling with a different element
 * disposes the prior open() state and re-opens against the new one.
 *
 * Returns true if WebGL initialised, false if it threw and we're on the
 * canvas fallback. The Terminal is usable either way.
 */
export function attach(paneId: PaneId, host: HTMLElement): boolean {
  const entry = entries.get(paneId);
  if (!entry) throw new Error(`no terminal for paneId=${paneId}`);

  // Already attached to the same host? Just re-fit.
  if (entry.attachedTo === host) {
    entry.fit.fit();
    return entry.webgl !== null;
  }

  entry.term.open(host);
  entry.attachedTo = host;

  // Initialise WebGL on first attach. If it fails, swallow and fall back to
  // canvas renderer; DESIGN.md §10 risk #3 mitigation.
  if (!entry.webgl) {
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      entry.term.loadAddon(webgl);
      entry.webgl = webgl;
    } catch (e) {
      entry.term.write(
        `\r\n\x1b[31m[webgl failed, using canvas: ${String(e)}]\x1b[0m\r\n`
      );
    }
  }

  entry.fit.fit();
  return entry.webgl !== null;
}

/** Drop the attachment without disposing the Terminal. */
export function detach(paneId: PaneId): void {
  const entry = entries.get(paneId);
  if (!entry) return;
  entry.attachedTo = null;
  // Note: xterm doesn't expose a "close without dispose" — but reattaching
  // via open() against a new element works for our case. The next attach
  // call will move it.
}

/** Fully dispose a Terminal and remove its entry. Called from the PTY orchestrator. */
export function disposeTerminal(paneId: PaneId): void {
  const entry = entries.get(paneId);
  if (!entry) return;
  try {
    entry.webgl?.dispose();
  } catch {
    // ignore
  }
  entry.term.dispose();
  entries.delete(paneId);
}

/** Resize hook — called from window resize or splitter drag. */
export function fitTerminal(paneId: PaneId): { cols: number; rows: number } | null {
  const entry = entries.get(paneId);
  if (!entry) return null;
  entry.fit.fit();
  return { cols: entry.term.cols, rows: entry.term.rows };
}

/** Direct write to xterm — bypasses any store. Used by the PTY data sink. */
export function writeToTerminal(paneId: PaneId, bytes: Uint8Array): void {
  const entry = entries.get(paneId);
  if (!entry) return;
  entry.term.write(bytes);
}

/** Hook into xterm's input event — keystrokes typed in the focused Terminal. */
export function onTerminalData(
  paneId: PaneId,
  handler: (data: string) => void
): { dispose(): void } {
  const entry = entries.get(paneId);
  if (!entry) throw new Error(`no terminal for paneId=${paneId}`);
  return entry.term.onData(handler);
}

/** Send the mouse-mode-reset escape sequences to xterm itself (not the PTY). */
export function resetMouseModes(paneId: PaneId): void {
  const entry = entries.get(paneId);
  if (!entry) return;
  entry.term.write(MOUSE_MODE_RESET);
}

/** Focus the terminal — pulls focus into the textarea xterm renders. */
export function focusTerminal(paneId: PaneId): void {
  entries.get(paneId)?.term.focus();
}

/** Test-only: nuke the registry. */
export function __resetRegistry(): void {
  for (const id of Array.from(entries.keys())) disposeTerminal(id);
}
