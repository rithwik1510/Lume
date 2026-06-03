// Lume type definitions — single source of truth per DESIGN.md §4 rule #10.
// Keep this file lean. Types mirror Rust counterparts where applicable.

// ---------- Pane / shell primitives ----------

/** A globally-unique id for a Terminal Pane. */
export type PaneId = string;

/** Detected/configured shell. v0.1 set per DESIGN.md §3. */
export type Shell =
  | { kind: "pwsh"; path: string }
  | { kind: "powershell"; path: string }
  | { kind: "cmd"; path: string }
  | { kind: "wsl"; distro: string };

/** Lifecycle status of a PTY-backed pane. */
export type PaneStatus = "spawning" | "running" | "exited" | "errored";

/**
 * Per-pane metadata. Lives in ptyStore. Throttled — see DESIGN.md §4 rule #4.
 * NOTE: PTY *bytes* never live here. They flow Rust → Channel → xterm directly.
 */
export interface PaneMetadata {
  paneId: PaneId;
  shell: Shell;
  /** Current working directory if we can resolve it. v0.1 leaves this null until shell integration. */
  cwd: string | null;
  status: PaneStatus;
  /** Epoch ms of the most recent PTY output. Updated at most every 200ms. */
  lastActivity: number;
  /** If status === "errored", reason from the Rust side. */
  errorReason: string | null;
}

// ---------- Layout ----------
// LayoutState was the Weekend 1 flat list type. The Weekend 2 store uses a
// binary tree; its shape is exported by src/store/layout/tree.ts as LayoutNode.
// Keeping this type alias here only as a forward-compat shim — anything that
// still imports LayoutState from "@/types" should migrate to importing the
// store directly via useLayoutStore.

// ---------- PTY channel events — mirror of Rust PtyEvent (src-tauri/src/pty.rs) ----------

/**
 * Messages that flow over the per-pane `Channel<PtyEvent>` from Rust → JS.
 * Three flavours: bytes, lifecycle exit, or an error.
 *
 * NOTE: `bytes` arrives as `number[]` because serde_json encodes `Vec<u8>` as
 * an array of numbers. The xterm sink converts via `new Uint8Array(bytes)`.
 * Optimising to a binary IPC channel is a v0.2+ optimisation.
 */
export type PtyEvent =
  | { kind: "data"; bytes: number[] }
  | { kind: "exit"; code: number | null }
  | { kind: "error"; error: AppError };

// ---------- Errors — mirror of Rust AppError enum (src-tauri/src/error.rs) ----------

/**
 * Discriminated union mirroring the Rust `AppError` enum. Tauri commands
 * return `Result<T, AppError>` and serde tags by `kind` (snake_case).
 *
 * To add a variant: add it to BOTH this union AND src-tauri/src/error.rs.
 */
export type AppError =
  | { kind: "pty_spawn_failed"; reason: string }
  | { kind: "pty_write_failed"; reason: string }
  | { kind: "pty_resize_failed"; reason: string }
  | { kind: "pty_not_found"; pane_id: string }
  | { kind: "internal"; reason: string };

/** Human-readable formatter for AppError. */
export function formatAppError(e: AppError): string {
  switch (e.kind) {
    case "pty_spawn_failed":
      return `PTY spawn failed: ${e.reason}`;
    case "pty_write_failed":
      return `PTY write failed: ${e.reason}`;
    case "pty_resize_failed":
      return `PTY resize failed: ${e.reason}`;
    case "pty_not_found":
      return `PTY not found for pane ${e.pane_id}`;
    case "internal":
      return `Internal error: ${e.reason}`;
  }
}
