// Workstation Rust entry point.

pub mod error;
pub mod pty;

pub use error::{AppError, AppResult};

/// Build the log plugin with safe defaults.
///
/// Why this is non-trivial: by default `tauri_plugin_log` will let every
/// dependency log at whatever level it chooses. `portable_pty::cmdbuilder`
/// emits a TRACE record for EACH environment variable it copies into the
/// spawned child — including secret-shaped values like `*_TOKEN`,
/// `*_API_KEY`, etc. Without a per-crate clamp those leak into stdout and
/// the on-disk log file.
///
/// Rules baked in here:
///   - Global default: DEBUG in dev builds, INFO in release.
///   - `portable_pty` and friends clamped to WARN — they're useful for
///     errors but they log env vars + arg vectors at TRACE/DEBUG.
///   - `tao` / `wry` / `webview2_com` similarly noisy; clamped.
///
/// If you ever flip `portable_pty` back to TRACE for debugging a real
/// spawn issue, scrub the resulting log file before pasting it anywhere.
fn build_log_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    let default_level = if cfg!(debug_assertions) {
        log::LevelFilter::Debug
    } else {
        log::LevelFilter::Info
    };
    tauri_plugin_log::Builder::new()
        .level(default_level)
        // Clamp dependency crates that log env vars / args verbosely.
        .level_for("portable_pty", log::LevelFilter::Warn)
        .level_for("portable_pty::cmdbuilder", log::LevelFilter::Warn)
        .level_for("tao", log::LevelFilter::Warn)
        .level_for("wry", log::LevelFilter::Warn)
        .level_for("webview2_com", log::LevelFilter::Warn)
        .build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(build_log_plugin())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .manage(pty::PtyRegistry::default())
        .invoke_handler(tauri::generate_handler![
            pty::pty_open,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
        ])
        .run(tauri::generate_context!())
        .expect("error while running workstation");
}
