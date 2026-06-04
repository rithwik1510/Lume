# Changelog

All notable changes to Lume are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0-beta.1] — 2026-06-03

First public beta. Windows only.

### Added
- Smooth tiled terminal panes (xterm.js + WebGL) backed by real PTYs with
  32 ms batched IPC and an 8 MB per-pane ring buffer.
- Session manager sidebar — grouped sessions, rename, attention glow when a
  background agent goes quiet.
- Session restore — reopen the last session on launch and pre-fill each pane's
  remembered first command at the prompt (never auto-run).
- Markdown editor (CodeMirror 6 / view-mode render) + MD Quick Viewer.
- Localhost Preview panel — iframe a dev server beside your terminals.
- Drag a file from Explorer or the file drawer onto a terminal.
- Settings UI with theme + font-pair presets; hot-reloaded `config.toml`.
- Toasts, confirm dialogs, split menu, keyboard-shortcuts viewer.
- In-app auto-update (Tauri updater).

### Known limitations
- Windows only this beta; macOS/Linux later.
- Installer is unsigned — Windows SmartScreen shows a warning (see README).
- PTYs do not survive restart; sessions revive layout + pre-filled commands,
  not live processes.

[0.1.0-beta.1]: https://github.com/rithwik1510/Workflow/releases/tag/v0.1.0-beta.1
