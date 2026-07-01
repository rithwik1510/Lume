// Wrappers around the Claude Code hook install/uninstall Rust commands
// (Plan 008 §5). The toggle in Settings drives these; the "installed" state is
// read straight from ~/.claude/settings.json (our shim path is the marker), so
// it's always the on-disk truth rather than a persisted preference.

import { invoke } from "@tauri-apps/api/core";

/** True if Lume's agent-event hooks are present in ~/.claude/settings.json. */
export function claudeHooksStatus(): Promise<boolean> {
  return invoke<boolean>("claude_hooks_status");
}

/** Additively merge Lume's hooks (atomic write). Rejects if settings.json can't
 *  be parsed — never overwrites a file we couldn't read. */
export function installClaudeHooks(): Promise<void> {
  return invoke<void>("install_claude_hooks");
}

/** Remove exactly Lume's hooks, preserving everything else. */
export function uninstallClaudeHooks(): Promise<void> {
  return invoke<void>("uninstall_claude_hooks");
}
