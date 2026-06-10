// Shell integration — materializes the embedded OSC 133 integration script
// to the Lume config dir so spawned shells can dot-source it.
//
// Why a file on disk instead of passing the script inline via -Command: the
// script is ~40 lines; inlining it into the spawn arg vector makes process
// listings unreadable and runs into cmdline length/quoting hazards. A file in
// %APPDATA%\lume is stable, debuggable, and user-inspectable.
//
// The file is rewritten on every launch (first use), so app updates ship new
// script versions without a migration step. Failure is non-fatal: callers get
// None and the shell spawns plain — Lume then falls back to output-cadence
// attention tracking for that pane.

use std::path::PathBuf;
use std::sync::OnceLock;

use crate::config::config_dir;

const POWERSHELL_SCRIPT: &str = include_str!("../assets/shell-integration.ps1");

static PS_SCRIPT_PATH: OnceLock<Option<PathBuf>> = OnceLock::new();

/// Path to the PowerShell integration script, writing it out on first call.
/// Returns None (and logs) if the config dir is unavailable or the write
/// fails — the caller spawns the shell without integration.
pub fn powershell_script_path() -> Option<PathBuf> {
    PS_SCRIPT_PATH
        .get_or_init(|| {
            let write = || -> Option<PathBuf> {
                let dir = config_dir().ok()?;
                std::fs::create_dir_all(&dir).ok()?;
                let path = dir.join("shell-integration.ps1");
                std::fs::write(&path, POWERSHELL_SCRIPT).ok()?;
                Some(path)
            };
            let result = write();
            if result.is_none() {
                log::warn!("shell integration script could not be written; cadence fallback");
            }
            result
        })
        .clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_script_defines_the_global_marks() {
        // Sanity: the asset actually carries the FinalTerm marks we parse on
        // the JS side (commandTracker.ts) and is idempotent-guarded.
        assert!(POWERSHELL_SCRIPT.contains("]133;D;"));
        assert!(POWERSHELL_SCRIPT.contains("]133;A"));
        assert!(POWERSHELL_SCRIPT.contains("]133;B"));
        assert!(POWERSHELL_SCRIPT.contains("]133;C"));
        assert!(POWERSHELL_SCRIPT.contains("__LumeIntegrationLoaded"));
    }
}
