// Workstation type definitions — single source of truth per DESIGN.md §4 rule #10.
// Phase 1 stub. Real types land in Phase 2.

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
