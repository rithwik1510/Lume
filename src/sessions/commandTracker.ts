// Command tracker — per-pane OSC 133 (FinalTerm) command-lifecycle state.
//
// The shell-integration script Lume injects into PowerShell-family shells
// (src-tauri/assets/shell-integration.ps1) emits:
//   133;A — prompt start        133;B — prompt end (input starts)
//   133;C — command executing   133;D;<exit> — command finished
//
// This module turns those marks into per-pane state the attention tracker
// consumes as ground truth: a pane that has EVER emitted a 133 mark is
// "integrated" — for it, "working" means a command is actually running and
// "finished" is the shell saying so, not an output-cadence guess. Panes that
// never emit 133 (cmd.exe, WSL for now) stay on the cadence fallback.
//
// Kept separate from attentionTracker so the dependency is one-way:
// attentionTracker subscribes to events here; this module knows nothing
// about sessions or stores.

import type { Terminal } from "@xterm/xterm";
import type { PaneId } from "@/types";

/** "none" = no 133 ever seen (not integrated). */
export type CommandState = "none" | "prompt" | "running";

export interface CommandEvent {
  /** "prompt-ready" fires on every 133;B — the shell finished rendering its
   *  prompt and is about to read input. The one provably-safe moment to
   *  programmatically type into the pane (autorun of remembered commands). */
  type: "integrated" | "prompt-ready" | "command-start" | "command-finished";
  paneId: PaneId;
  /** Exit code for command-finished, when the shell reported one. */
  exitCode: number | null;
}

type Listener = (evt: CommandEvent) => void;

const states = new Map<PaneId, CommandState>();
const listeners = new Set<Listener>();

export function paneCommandState(paneId: PaneId): CommandState {
  return states.get(paneId) ?? "none";
}

/** True once the pane's shell has proven it speaks OSC 133. */
export function paneIsIntegrated(paneId: PaneId): boolean {
  return states.has(paneId);
}

export function onCommandEvent(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(evt: CommandEvent): void {
  for (const l of listeners) l(evt);
}

/**
 * Feed one OSC 133 payload (the part after "133;"… i.e. "A", "C", "D;0").
 * Exported for tests; production input arrives via registerCommandTracking.
 */
export function handleOsc133(paneId: PaneId, data: string): void {
  const wasIntegrated = states.has(paneId);
  const mark = data.split(";", 1)[0];
  switch (mark) {
    case "A": {
      // Prompt (re)rendered. A without a preceding D would mean a command
      // ended without the D mark — treat it as back-at-prompt either way.
      states.set(paneId, "prompt");
      break;
    }
    case "B": {
      // Prompt end — input starts. Same state as A, plus the prompt-ready
      // event consumers use as the safe-to-type signal.
      states.set(paneId, "prompt");
      if (!wasIntegrated) emit({ type: "integrated", paneId, exitCode: null });
      emit({ type: "prompt-ready", paneId, exitCode: null });
      return;
    }
    case "C": {
      states.set(paneId, "running");
      if (!wasIntegrated) emit({ type: "integrated", paneId, exitCode: null });
      emit({ type: "command-start", paneId, exitCode: null });
      return;
    }
    case "D": {
      const prev = states.get(paneId);
      states.set(paneId, "prompt");
      if (!wasIntegrated) emit({ type: "integrated", paneId, exitCode: null });
      // A D that closes a running command is "finished". A D arriving from
      // "prompt" ALSO counts: it means a command ran whose C mark we never
      // saw (e.g. PSReadLine replaced our ReadLine wrapper, or the C arrived
      // before our handler registered). The only D we ignore is the very
      // first synthetic D;0 the integration's first prompt emits — at that
      // point the pane has no recorded state at all (prev === undefined).
      if (prev === "running" || prev === "prompt") {
        const raw = data.split(";")[1];
        const parsed = raw === undefined || raw === "" ? null : Number(raw);
        emit({
          type: "command-finished",
          paneId,
          exitCode: parsed !== null && Number.isFinite(parsed) ? parsed : null,
        });
      }
      return;
    }
    default:
      // Unknown sub-mark (e.g. 133;P from richer integrations) — absorb but
      // still counts as proof of integration.
      states.set(paneId, states.get(paneId) ?? "prompt");
      break;
  }
  if (!wasIntegrated) emit({ type: "integrated", paneId, exitCode: null });
}

/** Register the OSC 133 parser handler on a Terminal. Returns a disposer. */
export function registerCommandTracking(paneId: PaneId, term: Terminal): () => void {
  const d = term.parser.registerOscHandler(133, (data: string) => {
    handleOsc133(paneId, data);
    return true; // absorb — nothing downstream needs the raw mark
  });
  return () => d.dispose();
}

/** Forget a pane's state (pane killed). */
export function forgetPaneCommandState(paneId: PaneId): void {
  states.delete(paneId);
}

/** Test/HMR reset. Clears pane state but keeps subscriptions — the
 *  attentionTracker subscribes once at module load and must survive resets. */
export function disposeCommandTracker(): void {
  states.clear();
}
