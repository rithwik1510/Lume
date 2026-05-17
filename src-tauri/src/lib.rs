// Workstation Rust entry point. Phase 1 scaffold — empty surface.
// PTY infrastructure lands in Phase 4 (pty.rs + commands).
// Error types land in Phase 2 (error.rs with thiserror enum).

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![])
        .run(tauri::generate_context!())
        .expect("error while running workstation");
}
