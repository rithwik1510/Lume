// Thin TS wrapper over the Rust PTY commands. Centralises the invoke calls
// so the rest of the app talks to a typed surface, not stringly-typed Tauri
// command names.

import { Channel, invoke } from "@tauri-apps/api/core";
import type { AppError, PaneId, PtyEvent, Shell } from "@/types";

export interface OpenPtyArgs {
  paneId: PaneId;
  shell: Shell;
  cols: number;
  rows: number;
  /** Working directory to spawn the shell in (the owning session's folder).
   *  Omitted/undefined → the Rust side inherits the app's cwd. A path that no
   *  longer exists on disk is ignored server-side (falls back to inherited). */
  cwd?: string;
  channel: Channel<PtyEvent>;
}

/** Spawn a PTY. The Channel receives Data / Exit / Error events. */
export async function openPty(args: OpenPtyArgs): Promise<void> {
  await invoke<void>("pty_open", {
    paneId: args.paneId,
    shell: args.shell,
    cols: args.cols,
    rows: args.rows,
    cwd: args.cwd ?? null,
    channel: args.channel,
  });
}

export async function writePty(paneId: PaneId, data: string): Promise<void> {
  await invoke<void>("pty_write", { paneId, data });
}

export async function resizePty(
  paneId: PaneId,
  cols: number,
  rows: number
): Promise<void> {
  await invoke<void>("pty_resize", { paneId, cols, rows });
}

export async function killPty(paneId: PaneId): Promise<void> {
  await invoke<void>("pty_kill", { paneId });
}

/**
 * Heuristic for "this PTY has a running foreground process beyond the
 * idle shell" — used by the UI to gate the close-pane confirm dialog
 * (CONTEXT.md invariant 3). See pty.rs `is_pty_busy` for caveats.
 */
export function isPtyBusy(paneId: PaneId): Promise<boolean> {
  return invoke<boolean>("is_pty_busy", { paneId });
}

/** Type guard — Tauri rejects with an AppError-shaped object on command failure. */
export function isAppError(e: unknown): e is AppError {
  return (
    typeof e === "object" &&
    e !== null &&
    "kind" in e &&
    typeof (e as { kind: unknown }).kind === "string"
  );
}
