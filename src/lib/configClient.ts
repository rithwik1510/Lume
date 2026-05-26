// Thin TS wrappers around the Rust `config` commands. Full implementation
// lands in Phase 2 (DESIGN.md §6). Phase 1 ships a stub so the TopBar's
// Settings gear can dynamically import this module without a typecheck
// error — the gear logs a warning until Phase 2 wires the real command.

/**
 * Returns the absolute path to ~/.workstation/config.toml.
 *
 * Phase 1 stub: throws because the `config_file_path` Tauri command does
 * not exist yet. Phase 2 replaces this with `invoke("config_file_path")`.
 */
export async function configFilePath(): Promise<string> {
  throw new Error(
    "configClient.configFilePath() is a Phase 1 stub — the real command lands in Phase 2."
  );
}
