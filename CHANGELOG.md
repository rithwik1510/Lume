# Changelog

All notable changes to Lume are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0-beta.3] — 2026-06-08

Bug-fix release.

### Fixed
- **Markdown editor was blank and uneditable in the packaged app.** The viewer
  worked, but switching to edit mode (pencil) showed an unstyled gutter and no
  visible/editable content. Cause: CodeMirror styles itself by injecting
  `<style>` elements at runtime (style-mod). In a production Tauri build, Tauri's
  default CSP handling adds a `'nonce-…'` to `style-src`, and per the CSP3 spec a
  nonce makes the browser ignore `'unsafe-inline'` — so CodeMirror's nonce-less
  injected styles were blocked (`style-src-elem blocked=inline`), leaving the
  editor with no theme or layout. Dev builds were unaffected (the nonce is only
  injected in production). Fixed by setting
  `dangerousDisableAssetCspModification: ["style-src"]` so our intended
  `style-src 'self' 'unsafe-inline'` stays effective; `script-src` keeps its
  nonce. This also unblocks any other runtime-injected styles (e.g. xterm).

[0.1.0-beta.3]: https://github.com/rithwik1510/Workflow/releases/tag/v0.1.0-beta.3

## [0.1.0-beta.2] — 2026-06-06

Bug-fix release.

### Fixed
- **Windows console-window flicker / launch freeze.** Background `git` branch
  lookups (and WSL shell detection) spawned subprocesses without
  `CREATE_NO_WINDOW`, so Windows flashed a black console window on every call —
  every ~5 s per active session and on each window focus. This presented as
  whole-window flicker, and on launch with a restored session the rapid
  focus-stealing froze the window. Both spawns now run with no console window.
- **Session restore no longer auto-types the remembered command** into the
  revived shell — replaying it raced PowerShell's line editor and could garble
  or freeze the prompt. The command is still remembered on the pane.

### Changed
- Reopen-last-session-on-launch is temporarily disabled: launch starts with all
  sessions stopped (click a session in the sidebar to revive it). Returns in a
  later build once re-verified against the fixes above.

[0.1.0-beta.2]: https://github.com/rithwik1510/Workflow/releases/tag/v0.1.0-beta.2

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
