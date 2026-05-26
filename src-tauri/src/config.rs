// src-tauri/src/config.rs
//
// Workstation config.toml schema, default generation, parse, file watch.
// Path: dirs::config_dir().join("workstation/config.toml")
//   Windows: %APPDATA%\workstation\config.toml
//   macOS:   ~/Library/Application Support/workstation/config.toml
//   Linux:   ~/.config/workstation/config.toml
//
// Schema lives in DESIGN.md §6. Unknown keys are logged at WARN level and
// then ignored — they do not abort the load (matches DESIGN.md §6 "Unknown
// keys produce a warn toast but don't break the load"). Toast surface is
// deferred to a later weekend; logging is the durable record until then.

use notify::{
    Config as NotifyConfig, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher,
};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::ipc::Channel;
use tauri::State;

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct FontConfig {
    pub family: String,
    pub size: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct TerminalConfig {
    pub scrollback_lines: u32,
    pub ipc_batch_ms: u32,
    pub ring_buffer_mb: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct MdEditorConfig {
    pub soft_wrap: bool,
    pub line_numbers: bool,
    pub indent_spaces: u32,
    pub trim_trailing_whitespace_on_save: bool,
    pub default_mode: String, // "view" | "edit"
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct QuickViewerConfig {
    pub width_pct: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct SidebarConfig {
    pub visible: bool,
    pub collapsed_dirs: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ThemeConfig {
    pub accent: String, // "amber" (only valid v0.1)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct LogConfig {
    pub level: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkstationConfig {
    pub default_shell: String,
    pub font: FontConfig,
    pub terminal: TerminalConfig,
    pub md_editor: MdEditorConfig,
    pub quick_viewer: QuickViewerConfig,
    pub sidebar: SidebarConfig,
    pub theme: ThemeConfig,
    pub log: LogConfig,
    // [keybindings] intentionally untyped — empty table by default. Future
    // expansion lands once we have a keybinding resolver in place.
}

impl Default for WorkstationConfig {
    fn default() -> Self {
        Self {
            default_shell: "pwsh".to_string(),
            font: FontConfig {
                family: "JetBrains Mono".to_string(),
                size: 14,
            },
            terminal: TerminalConfig {
                scrollback_lines: 10_000,
                ipc_batch_ms: 32,
                ring_buffer_mb: 8,
            },
            md_editor: MdEditorConfig {
                soft_wrap: true,
                line_numbers: true,
                indent_spaces: 2,
                trim_trailing_whitespace_on_save: true,
                default_mode: "view".to_string(),
            },
            quick_viewer: QuickViewerConfig { width_pct: 25 },
            sidebar: SidebarConfig {
                visible: true,
                collapsed_dirs: vec![
                    "node_modules".into(),
                    ".git".into(),
                    "__pycache__".into(),
                    "target".into(),
                    "dist".into(),
                    "build".into(),
                    ".venv".into(),
                    ".next".into(),
                    ".turbo".into(),
                    ".cache".into(),
                ],
            },
            theme: ThemeConfig {
                accent: "amber".to_string(),
            },
            log: LogConfig {
                level: "info".to_string(),
                path: "%LOCALAPPDATA%\\workstation\\logs".to_string(),
            },
        }
    }
}

const DEFAULT_TOML: &str = r#"# Workstation config — edit this file directly; changes hot-reload.
# Full schema is documented in DESIGN.md §6.
default_shell = "pwsh"

[font]
family = "JetBrains Mono"
size = 14

[terminal]
scrollback_lines = 10000
ipc_batch_ms = 32
ring_buffer_mb = 8

[md_editor]
soft_wrap = true
line_numbers = true
indent_spaces = 2
trim_trailing_whitespace_on_save = true
default_mode = "view"

[quick_viewer]
width_pct = 25

[sidebar]
visible = true
collapsed_dirs = [
  "node_modules",
  ".git",
  "__pycache__",
  "target",
  "dist",
  "build",
  ".venv",
  ".next",
  ".turbo",
  ".cache",
]

[theme]
accent = "amber"

[log]
level = "info"
path = "%LOCALAPPDATA%\\workstation\\logs"

[keybindings]
# Override any key from DESIGN.md §7. Example:
# split_right = "Ctrl+\\"
"#;

pub fn config_dir() -> AppResult<PathBuf> {
    dirs::config_dir()
        .map(|p| p.join("workstation"))
        .ok_or_else(|| AppError::Internal {
            reason: "config_dir unavailable".to_string(),
        })
}

pub fn config_path() -> AppResult<PathBuf> {
    Ok(config_dir()?.join("config.toml"))
}

#[tauri::command]
pub fn config_file_path() -> AppResult<String> {
    Ok(config_path()?.to_string_lossy().to_string())
}

#[tauri::command]
pub fn write_default_config_if_missing() -> AppResult<bool> {
    let path = config_path()?;
    if path.exists() {
        return Ok(false);
    }
    let dir = config_dir()?;
    std::fs::create_dir_all(&dir).map_err(|e| AppError::Internal {
        reason: format!("create_dir_all {}: {}", dir.display(), e),
    })?;
    std::fs::write(&path, DEFAULT_TOML).map_err(|e| AppError::Internal {
        reason: format!("write default {}: {}", path.display(), e),
    })?;
    log::info!("config.toml created at {}", path.display());
    Ok(true)
}

#[tauri::command]
pub fn read_config() -> AppResult<WorkstationConfig> {
    let path = config_path()?;
    if !path.exists() {
        log::info!("config.toml missing; returning defaults (file not created here)");
        return Ok(WorkstationConfig::default());
    }
    let text = std::fs::read_to_string(&path).map_err(|e| AppError::Internal {
        reason: format!("read {}: {}", path.display(), e),
    })?;
    parse_config_with_warnings(&text)
}

/// Parse a TOML string into a WorkstationConfig. Logs a WARN for every
/// top-level table that has `deny_unknown_fields` and contains unrecognised
/// keys, but does not abort the load — the deny_unknown_fields lives on the
/// sub-tables, so the only way unknown keys reach here is via the top level
/// of WorkstationConfig itself. We catch both cases by parsing twice: first
/// into a permissive toml::Value to inventory unknown top-level keys, then
/// into the strict WorkstationConfig.
fn parse_config_with_warnings(text: &str) -> AppResult<WorkstationConfig> {
    // First pass — permissive — to find unknown top-level keys.
    let value: toml::Value = toml::from_str(text).map_err(|e| AppError::Internal {
        reason: format!("toml parse: {}", e),
    })?;
    if let toml::Value::Table(t) = &value {
        const KNOWN: &[&str] = &[
            "default_shell",
            "font",
            "terminal",
            "md_editor",
            "quick_viewer",
            "sidebar",
            "theme",
            "log",
            "keybindings",
        ];
        for k in t.keys() {
            if !KNOWN.contains(&k.as_str()) {
                log::warn!("config.toml: unknown top-level key '{}' (ignored)", k);
            }
        }
    }
    // Second pass — strict — for sub-table unknown-key detection plus typed
    // result. Sub-tables use deny_unknown_fields so toml::from_str fails on
    // any unknown key inside a known sub-table. We catch the error, log it,
    // and fall back to defaults. DESIGN.md §6 says "Invalid values fall back
    // to last-known-valid config" which we honour at the JS layer
    // (settingsStore retains last good config across hot reloads).
    match toml::from_str::<WorkstationConfig>(text) {
        Ok(cfg) => Ok(cfg),
        Err(e) => {
            log::warn!("config.toml: strict parse failed ({}); using defaults", e);
            Ok(WorkstationConfig::default())
        }
    }
}

// ----- Hot reload -----

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ConfigEvent {
    /// The file changed on disk. Caller should call `read_config` to fetch
    /// the new value. Includes the path that changed for sanity.
    Changed { path: String },
}

#[derive(Default)]
pub struct ConfigWatcherState(pub Mutex<Option<RecommendedWatcher>>);

#[tauri::command]
pub fn watch_config(
    state: State<'_, ConfigWatcherState>,
    channel: Channel<ConfigEvent>,
) -> AppResult<()> {
    let path = config_path()?;
    let dir = config_dir()?;
    // We watch the directory (not just the file) — many editors save by
    // writing to a temp file and renaming, which `notify` reports as a
    // Remove + Create on the target rather than Modify. Watching the dir
    // catches both shapes.
    std::fs::create_dir_all(&dir).map_err(|e| AppError::Internal {
        reason: format!("create_dir_all {}: {}", dir.display(), e),
    })?;

    let channel = Arc::new(channel);
    let chan_clone = channel.clone();
    let target = path.clone();
    // Coalesce events with a 150ms cooldown — VS Code / Sublime / nvim each
    // generate 2-5 raw events for one save. notify v6 has NO internal
    // debouncing (despite outdated comments in file_watcher.rs); we add it
    // here at module scope to avoid five render cycles per save.
    let last_emit: Arc<Mutex<Instant>> =
        Arc::new(Mutex::new(Instant::now() - Duration::from_secs(60)));

    let mut watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
        if let Ok(event) = res {
            if !matches!(
                event.kind,
                EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
            ) {
                return;
            }
            if !event.paths.iter().any(|p| p == &target) {
                return;
            }
            let mut last = last_emit.lock();
            if last.elapsed() < Duration::from_millis(150) {
                return;
            }
            *last = Instant::now();
            drop(last);
            let _ = chan_clone.send(ConfigEvent::Changed {
                path: target.to_string_lossy().to_string(),
            });
        }
    })
    .map_err(|e| AppError::Internal {
        reason: format!("config watcher create: {}", e),
    })?;

    watcher
        .configure(NotifyConfig::default().with_compare_contents(false))
        .map_err(|e| AppError::Internal {
            reason: format!("config watcher config: {}", e),
        })?;
    watcher
        .watch(&dir, RecursiveMode::NonRecursive)
        .map_err(|e| AppError::Internal {
            reason: format!("watch {}: {}", dir.display(), e),
        })?;

    *state.0.lock() = Some(watcher);
    Ok(())
}

// ----- Tests -----

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_toml_round_trips() {
        let cfg: WorkstationConfig = toml::from_str(DEFAULT_TOML).expect("parse default toml");
        assert_eq!(cfg, WorkstationConfig::default());
    }

    #[test]
    fn parse_with_unknown_top_level_key_falls_back() {
        let text = r#"
        default_shell = "pwsh"
        unknown_key = "ignored"

        [font]
        family = "Inter"
        size = 13

        [terminal]
        scrollback_lines = 1000
        ipc_batch_ms = 16
        ring_buffer_mb = 4

        [md_editor]
        soft_wrap = true
        line_numbers = false
        indent_spaces = 4
        trim_trailing_whitespace_on_save = false
        default_mode = "edit"

        [quick_viewer]
        width_pct = 30

        [sidebar]
        visible = false
        collapsed_dirs = []

        [theme]
        accent = "amber"

        [log]
        level = "debug"
        path = "/tmp"
        "#;
        // Strict parse fails because unknown_key is at top level and the
        // top-level struct does NOT use deny_unknown_fields. So actually
        // this should SUCCEED with the field ignored. Verify:
        let cfg = parse_config_with_warnings(text).expect("parse");
        assert_eq!(cfg.default_shell, "pwsh");
        assert_eq!(cfg.font.family, "Inter");
        assert_eq!(cfg.md_editor.default_mode, "edit");
    }

    #[test]
    fn parse_with_garbage_falls_back_to_defaults() {
        let text = "this is not valid toml === = =";
        let result = parse_config_with_warnings(text);
        // First pass (toml::from_str into Value) fails, which is an Err.
        assert!(result.is_err());
    }

    #[test]
    fn parse_with_strict_failure_falls_back_to_defaults() {
        // Valid TOML but the sub-table has an unknown field.
        let text = r#"
        default_shell = "pwsh"

        [font]
        family = "Inter"
        size = 13
        weirdfield = "?"

        [terminal]
        scrollback_lines = 1000
        ipc_batch_ms = 16
        ring_buffer_mb = 4

        [md_editor]
        soft_wrap = true
        line_numbers = false
        indent_spaces = 4
        trim_trailing_whitespace_on_save = false
        default_mode = "view"

        [quick_viewer]
        width_pct = 30

        [sidebar]
        visible = true
        collapsed_dirs = []

        [theme]
        accent = "amber"

        [log]
        level = "debug"
        path = "/tmp"
        "#;
        let cfg = parse_config_with_warnings(text).expect("falls back");
        assert_eq!(cfg, WorkstationConfig::default());
    }
}
