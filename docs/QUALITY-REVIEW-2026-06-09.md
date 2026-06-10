# Lume — Quality Review vs Best-in-Class (2026-06-09)

Deep review of the PTY data path, React rendering, Rust backend, and feature depth,
compared against Warp, WezTerm, Windows Terminal, VS Code, iTerm2, and agent
orchestrators (Conductor, Claude Squad).

## Headline

Engineering craft is genuinely above average for a Tauri app — raw bytes over
Channel (no JSON), terminals in a module registry surviving React mounts,
drag-gated WebGL fits, no `unwrap` in Rust prod paths. The architecture would not
embarrass VS Code's pty host.

But the product's core thesis — **attention detection — is the weakest feature in
the app**, and a handful of structural gaps make it feel ~2 frames slower than
Windows Terminal and silently corrupt under stress.

---

## Critical

### 1. Attention detection is a heuristic that trains users to ignore the dot
The 8s output-quiet rule is structurally wrong, not tunable:
- False positives: quiet compile, agent mid-tool-call, plain idle shell after `ls`.
- False negatives: Claude Code's idle prompt animates (cursor blink, status line),
  so a waiting agent may never go quiet.
- It detects "stopped streaming," not "needs you."

Best-in-class: **OSC 133 shell integration** (prompt-start / command-start /
command-finished + exit code). VS Code, Warp, WezTerm, Windows Terminal all use it.
We already register OSC handlers (9/99/777) — parsing 133 is the same mechanism.
Pull shell integration forward from v0.4; it IS the product. Unlocks true
working/waiting/idle tri-state.

### 2. No flow control — `cat bigfile` silently corrupts terminal state
8MB ring drops **oldest** bytes mid-stream (`pty.rs:83-94`) — can split an escape
sequence, leaving the terminal in a broken mode. Fix: reader thread **blocks** on a
high-water mark (~1MB) instead of dropping; ConPTY pipe fills, child blocks — free
XOFF semantics, zero data loss. (VS Code uses ack-based flow control.)

### 3. Sync Tauri commands run on the main thread — up to 2s UI freezes
`git_current_branch` blocks on `recv_timeout(2s)` per branch poll; `detect_shells`
runs `wsl.exe` synchronously (seconds on cold WSL); `pty_open`, fs commands also
sync. Fix: `async fn` + `spawn_blocking`. Single highest-leverage backend change.

### 4. `pty_kill` orphans the process tree; no cleanup on app exit
TerminateProcess hits the shell only — node/claude/WSL descendants survive. No
`RunEvent::Exit` handler; with `panic = "abort"` any thread panic leaves everything
running. Fix: **Win32 Job Objects with kill-on-job-close** (what Windows
Terminal/VS Code do) — solves kill-tree + exit + crash cleanup in one move.

## High — perceived smoothness

### 5. Fixed 32ms flush adds ~16–32ms echo latency to every keystroke
Windows Terminal frame-paces (~8ms effective). Fix: condvar-driven flusher — flush
immediately when buffer was empty (interactive case), coalesce 8–16ms under load.
Biggest "feel" improvement available; also kills per-pane idle wakeups.

### 6. "Bytes never wake React" leaks in two places
- `attentionTracker.noteOutput` runs per byte chunk: session-tree walk + array
  allocations + setTimeout churn; `DEBUG = true` ships console spam to production.
  Throttle ~250ms, cache paneId→sessionId, flip DEBUG off.
- `StatusBar` subscribes to whole `panes` record → re-renders ~5×/sec per streaming
  pane (including hidden ones). Narrow selector / move `lastActivity` out of Zustand.

### 7. fs commands accept arbitrary absolute paths
Compromised renderer can read `~/.ssh/id_rsa`, `.aws/credentials`. Scope fs
reads/writes to workspace roots after canonicalization; validate `pty_open` shell
paths against `detect_shells`. Tighten `frame-src http: https:` → localhost only.
Move the passwordless updater key out of the OneDrive-synced tree.

## Medium — table stakes the competition has

| Gap | Effort | Why |
|---|---|---|
| No Ctrl+F search in scrollback (`addon-search`) | ~½ day | Every comparator has it |
| No clickable URLs (`addon-web-links`) | ~1 hr | Universal table stake |
| No multiline paste warning | ~½ day | Safety when pasting into agent prompts |
| No OS notifications / taskbar badge | ~2 days | Attention system invisible when minimized |
| No `windowsPty` option + unicode11 addon | hours | ConPTY reflow artifacts; emoji/box-drawing misalignment in agent TUIs |
| Ctrl+Left/Right steals readline word-jump | hours | Daily papercut; Warp/WT use Alt+arrow |
| No Ctrl+F in MD editor + silent data loss on dirty tab close | ~1 day | Editor exists to read agent plans |
| CodeMirror destroyed/rebuilt per view↔edit toggle & tab switch | ~1 day | Obsidian keeps one EditorView, swaps EditorStates |
| Non-atomic writes (config AND user markdown) | hours | Crash mid-write truncates; temp+rename |
| File watcher: no native exclusions — `npm install` floods IPC | ~½ day | Filter `node_modules`/`.git` in notify callback + Rust coalescing |
| No code-splitting — CodeMirror + markdown-it parsed pre-first-paint | ~½ day | Lazy-load MdEditor/Preview/modals |
| `dot-glow` animates box-shadow forever (60fps paint while any dot shows) | ~1 hr | Animate opacity on pseudo-element |
| Dead "Filter & options" button (no onClick) | minutes | Shipped-dead UI erodes trust |
| Sidebar not keyboard/SR operable (clickable divs; dot aria-hidden) | 1–2 days | A11y baseline |

## Already best-in-class

- Raw-byte Channel IPC (most Tauri terminals get this wrong)
- Splitter drag: uncontrolled panels, debounced commits, WebGL-clear avoidance
- Branch poller pauses on blur, immediate on focus
- Mouse-mode panic reset (Ctrl+Shift+R)
- Error-handling discipline, format-preserving TOML edits, reduced-motion support

## Recommended order (~3 weeks total)

1. OSC 133 attention system (~1 wk) — turns the product thesis from guess to fact
2. Backend trio: async commands, job objects, blocking-reader flow control (~3–4 d)
3. Latency: condvar flush + attentionTracker/StatusBar hot paths (~2 d)
4. Table-stakes sweep: search, web-links, paste warning, notifications, badge (~4 d)
5. fs scoping + atomic writes + watcher exclusions (~2 d)
