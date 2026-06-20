# Changelog

All notable changes to Lume are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); this project uses
[Semantic Versioning](https://semver.org/).

## [0.1.0-beta.7] — 2026-06-20

Smooth with a fleet of sessions open.

### Performance
- **Off-screen sessions no longer render in real time.** Every session you have
  open kept parsing its output into the renderer even when you couldn't see it,
  so a fleet of 6-7+ sessions under heavy output could saturate the UI and
  freeze. Now only the session(s) on screen render live; background sessions
  keep running and replay instantly the moment you switch back. The app's cost
  is bounded by what's on screen, not by how many sessions you've opened.
- **WebGL terminal contexts are pooled and capped.** Many open sessions can no
  longer exhaust the GPU's context limit and drop terminals to slow rendering.

## [0.1.0-beta.6] — 2026-06-19

View two sessions side-by-side.

### Added
- **Drag a session onto the screen to split it.** Grab any session from the
  sidebar and drop it on the terminal area — it docks beside the one you're in,
  so you can watch two projects (or two agents in different folders) at once. A
  "Drop to split" hint shows where it'll land; the seam between them drags to
  rebalance, clicking either side hands it the keyboard, and the × on the seam
  collapses back to one. The dragged-in session revives the same way clicking it
  does, and nothing is torn down when you close the split — it just goes back to
  being a background session. Split view replaces the Quick Viewer / Preview /
  Markdown editor while it's open (and they replace it), and it's a transient
  view — a fresh launch always opens single.

[0.1.0-beta.6]: https://github.com/rithwik1510/Workflow/releases/tag/v0.1.0-beta.6

## [0.1.0-beta.5] — 2026-06-10

Your agents come back when you reopen Lume, plus attention-signal polish.

### Added
- **Restored sessions relaunch their agent.** When Lume reopens a session (on
  launch or when you click a stopped one), the command you last ran in each
  pane is re-run automatically — so closing Lume mid-`claude` and reopening
  brings the agent back, not just an empty prompt. The command is typed only
  once the shell reports it's ready for input (via OSC 133), which is what made
  this safe to turn back on after the earlier prompt-freeze. Shells without
  shell integration (cmd, WSL) revive to a plain prompt.
- **Command memory tracks your latest launch.** Each pane remembers the most
  recent command you ran at its prompt (replacing the old "first command ever"
  behavior). Answers you type *into* a running agent are never mistaken for a
  launch command, so restore re-runs the right thing.
- **Animated logo loader.** The "working" indicator is now the Lume mark — the
  accent square tumbling clockwise inside the logo box — replacing the generic
  spinning ring. Its square shape also distinguishes "working" from the dot
  states at a glance.

### Changed
- **Legacy "New session" rows are renamed on launch.** Sessions saved before
  sequential naming shipped now become `Session 1`, `Session 2`, … per folder
  the moment the app loads, with a subtle slide-in as the new name appears.
- **Larger +/delete buttons** on session rows and folder headers — easier to
  see and to hit.

### Fixed
- **An idle agent no longer shows a phantom "working" loader.** An open-but-idle
  TUI (e.g. `claude` waiting at its input box) periodically repaints its status
  line; each repaint used to flip the spinner back on and wipe the needs-you
  dot, so quiet agents looked permanently busy. Working now requires a sustained
  output stream, so an idle agent settles into a steady dot and stays there.

[0.1.0-beta.5]: https://github.com/rithwik1510/Workflow/releases/tag/v0.1.0-beta.5

## [0.1.0-beta.4] — 2026-06-10

Attention system rebuilt, session restore returns, plus naming and terminal polish.

### Added
- **Shell integration (OSC 133) for accurate agent attention.** Lume now injects
  a small FinalTerm script into PowerShell-family shells so the shell itself
  reports when a command starts and finishes. The sidebar shows two honest
  signals per background session: a **spinning ring** while an agent/command is
  actively working, and an **accent dot** the moment its turn finishes or it
  blocks for your input. This replaces the old output-silence guess that could
  light up while an agent was still busy.
- **Session restore on launch is back — and reopens the whole fleet.** Every
  session that was running when you last closed Lume revives on startup with its
  terminals, layout, shell, and folder; the session you were last in is focused.
  (Processes themselves can't survive a restart — the workspace comes back, not
  live agents.)
- **Sequential session names.** New sessions are named `Session 1`, `Session 2`,
  … per folder instead of all reading "New session".

### Fixed
- **No more phantom attention signals.** Switching away from a session, leaving an
  idle agent, or resizing the window no longer fakes "working"/"done" cues. The
  repaints a background terminal emits during a switch or resize are filtered, so
  the signals reflect only real activity that happens after you leave.
- **Terminal no longer flickers or clips its prompt on session switch.** Hidden
  panes (a backgrounded session) reported a 0×0 size and were being resized to a
  degenerate grid, which rewrapped the shell's lines and left the prompt clipped.
  Hidden/zero-size and no-op resizes are now skipped.

[0.1.0-beta.4]: https://github.com/rithwik1510/Workflow/releases/tag/v0.1.0-beta.4

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
