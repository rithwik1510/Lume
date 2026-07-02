# Plan 008: Exact agent-state detection via agent hooks (pane-tagged)

## Status

APPROVED — drafted 2026-07-02 from operator direction ("detection of agent
state must be exact before we ship sounds/notifications"); design decisions
locked with the operator the same day (see "Design" section). Not part of the
2026-06-12 improve-skill audit batch (001–007). Hook facts below were
verified against the official Claude Code docs on 2026-07-02
(https://code.claude.com/docs/en/hooks, /hooks-guide.md, /setup.md) and the
Codex hooks docs (https://developers.openai.com/codex/hooks).
Execution model: spike (step 0) gates everything; implementation runs on a
worktree branch per repo convention; reviewed before merge.

## Goal

Lume knows, per pane, **exactly** — not by guessing from output cadence:

1. **Which agent** is running (Claude Code first; Codex phase 3; others fall
   back to the existing heuristics).
2. **What state it is in**:
   - `working` — a turn is in progress
   - `needs-input (permission)` — blocked on a permission prompt
   - `needs-input (idle)` — turn finished, waiting for the user's next prompt
   - `turn-complete` — Stop fired (the "come review this" moment)
   - `gone` — agent exited / session ended

These become a new **deterministic signal class** feeding `attentionTracker`,
ranked above OSC 133 and the cadence fallback. The existing heuristic tiers
stay (they cover builds, tests, unknown CLIs, and agents without hooks) —
they just remain confined to the in-window dot. Only deterministic signals
will ever be allowed to drive OS notifications/sounds (future work, out of
scope here).

## Why hooks (reliability ranking)

| Source | Exactness | Why / why not |
|---|---|---|
| **Agent hooks** (this plan) | Exact | The agent itself announces every state transition, with the reason. No parsing, no timing guesses. Only source that distinguishes "working quietly" from "blocked on permission". |
| Transcript JSONL watching | Near-exact, lagging | Rich (task text, files touched) but write-cadence-lagged and no clean idle/permission distinction. Good later for dashboard enrichment, wrong tool for state. |
| OSC 133 | Exact for *shell commands* only | `claude` is one long-running command; A/B/C/D marks say nothing about turns inside the TUI. |
| Output cadence | Guess | Today's fallback (QUIET_MS=5000 etc.). Fine for a dot, not for a ping. |

Verified hook facts this plan relies on:

- Events: `SessionStart` (payload `source`), `UserPromptSubmit` (payload
  `prompt`), `Stop`, `Notification` (matchers `permission_prompt`,
  `idle_prompt`, …), `SessionEnd`. Common stdin JSON fields on every event:
  `session_id`, `transcript_path`, `cwd`, `hook_event_name`.
- Non-tool events need no matcher; `Notification` uses matchers to
  distinguish permission vs idle.
- Hooks merge additively across `~/.claude/settings.json` and project
  settings — installing ours does not clobber the user's existing hooks.
- `"async": true` (Jan 2026+) runs a hook without blocking Claude at all.
  `Stop`/`Notification`/`SessionStart` are non-blocking event types anyway.
- On Windows, hook commands run via **Git Bash if Git for Windows is
  installed, else PowerShell** — the hook command we install must work in
  both (see step 4).
- Codex CLI has an equivalent hooks system (`~/.codex/hooks.json`;
  `SessionStart`, `PreToolUse`, `PostToolUse`, `PermissionRequest`, `Stop`)
  plus the simpler `notify` = `agent-turn-complete`. Phase 3.

## Architecture (5 pieces)

```
pty_open sets LUME_PANE_ID ──inherited──▶ shell ─▶ claude ─▶ hook process
                                                              │ appends stdin JSON to
                                                              ▼
                                    %APPDATA%\lume\agent-events\<LUME_PANE_ID>.jsonl
                                                              │ notify-watcher (Rust)
                                                              ▼
                                    Tauri event "agent-event" { paneId, payload }
                                                              │
                                                              ▼
                              sessions/agentTracker.ts (state machine per pane)
                                                              │
                                                              ▼
                        attentionTracker signal class A  +  sidebar agent glyph/state
```

### 1. Pane identity: env-var tagging at spawn (the linchpin)

`src-tauri/src/pty.rs` `build_command()` already sets env vars (`TERM`,
`COLORTERM`, `FORCE_COLOR`), and `pty_open` receives `pane_id`. Add:

- `cmd.env("LUME_PANE_ID", pane_id)` (thread `pane_id` into
  `build_command`).
- `cmd.env("WSLENV", "LUME_PANE_ID/u")` **merged with any existing WSLENV
  value** so the tag crosses the Win32→WSL boundary for WSL panes.

Every descendant process — the shell, `claude`, and each hook process claude
spawns — inherits the tag. Two panes in the same folder, worktrees, nested
shells: all disambiguated for free. No cwd matching, no PID-ancestry walking.

### 2. Transport: append-only spool files, one per pane

The installed hook command is deliberately dumb — **no parsing in the hook**:

- Guard: if `LUME_PANE_ID` is unset (claude running outside Lume), exit 0
  silently.
- Else append raw stdin (the full hook JSON, one line) to
  `%APPDATA%\lume\agent-events\$LUME_PANE_ID.jsonl`.

The **filename carries the pane id**; the body is untouched hook JSON
(`hook_event_name` + matcher info + `session_id` + `transcript_path` inside).
Events are low-frequency (per turn, not per byte); small appends are safe.
Lume deletes a pane's spool file on pane close and sweeps stale files at
boot.

Why not HTTP hooks / a localhost server: hooks support `"type": "http"`, but
Lume would have to run an HTTP listener — new attack surface that Plan 004 is
trying to shrink. The file spool reuses infrastructure Lume already trusts
(`notify` watcher, `shell_integration.rs`-style materialized assets).

### 3. Rust: `agent_events.rs` (new module)

- Ensure the spool dir exists at boot; start a `notify` watcher on it
  (same debounce pattern as `config.rs`).
- Track a read offset per file; on change, read appended lines, parse the
  few fields Lume needs (`hook_event_name`, matcher/`notification_type`,
  `session_id`, `transcript_path`, `cwd`), and emit a Tauri event
  `agent-event` `{ paneId, event, kind, sessionId, transcriptPath }` to the
  frontend. Malformed lines: WARN + skip (same tolerance stance as config).
- Commands: none needed for v1 (push-only), plus a `sweep_agent_events`
  housekeeping call on boot/pane-close.

### 4. Hook installation (opt-in, additive, reversible)

Settings toggle: **"Precise Claude Code signals"**.

- ON: merge Lume's hook entries into `~/.claude/settings.json` —
  parse JSON, append to `hooks.SessionStart / UserPromptSubmit / Stop /
  Notification / SessionEnd` arrays **without touching existing entries**,
  each entry `{"type": "command", "command": <lume hook cmd>, "async": true,
  "timeout": 10}`. Write atomically (temp + rename — Plan 005's concern
  applies doubly to a file we don't own). Tag our entries so OFF can find
  them (the command string itself is the marker).
- OFF: remove exactly our entries; leave everything else byte-preserved as
  much as JSON round-tripping allows.
- The hook command must run under **both** Git Bash and PowerShell (Windows
  hook shell depends on whether Git for Windows is installed). Two options,
  decided in the spike (step 0):
  a. A one-liner that works in `sh` (`[ -n "$LUME_PANE_ID" ] && cat >>
     "$APPDATA/lume/agent-events/$LUME_PANE_ID.jsonl"`), plus a PowerShell
     variant selected at install time by probing for Git Bash — fragile if
     the user installs/uninstalls git later.
  b. **Preferred:** materialize a tiny script per shell family the way
     `shell_integration.rs` already materializes the OSC 133 PS1 script, and
     install the invocation that works in both (e.g. a `.cmd` shim callable
     from sh and PowerShell alike).
- Settings UI shows install state and a "hooks not detected in this Claude
  Code version" warning if the settings write succeeded but no
  `SessionStart` event ever arrives from a claude launched afterwards.

### 5. Frontend: `sessions/agentTracker.ts` (new) + attention integration

Per-pane state machine driven only by `agent-event`:

| Event | New pane state | Notes |
|---|---|---|
| `SessionStart` | agent=claude, `idle` | record `session_id`, `transcript_path` (dashboard fuel later) |
| `UserPromptSubmit` | `working` | turn began |
| `Notification` / `permission_prompt` | `needs-input (permission)` | the money signal — mid-turn block |
| `Stop` | `turn-complete` | primary "come look" moment |
| `Notification` / `idle_prompt` | `needs-input (idle)` | confirms waiting-at-prompt |
| `SessionEnd` | agent gone, revert pane to heuristic tiers | |

Integration rules:

- `attentionTracker` gains a **class A (deterministic)** input ranked above
  OSC 133 (class B) and cadence (class C). While a pane has a live agent
  session (SessionStart seen, no SessionEnd), class A **owns** that pane's
  working/unread signals; cadence noise is ignored for it.
- Sidebar (`SessionRow`/`SplitPair`): agent glyph next to the ring/dot and
  the precise reason on hover ("Claude — waiting on permission"). The
  existing ring/dot visuals are unchanged — they just become *true* when a
  hooked agent is present.
- Signal-class metadata is kept on every attention transition so future
  notification/sound work can route on it (class A escapes the window;
  class B/C never do). That routing itself: out of scope.

## Design (locked with operator, 2026-07-02)

The existing sidebar grammar is deliberate and is EXTENDED, not replaced
(`SessionRow.module.css` documents it): **shape** separates working from
everything else (tumbling logo square vs circles); **saturation** is reserved
for "needs you" (the accent is the only saturated thing in the list); hollow
grey = idle, filled grey = the visible session, and **the visible session
never signals**. All of that stays.

### State → indicator mapping (session rows, split-pair members)

| State (from agentTracker) | Indicator |
|---|---|
| `working` | Tumbling logo square — **unchanged** |
| `needs-input (permission)` — blocked mid-turn | **Hollow accent ring**: 8px circle, 1.5px `var(--accent)` border, transparent fill, plus the animated glow pulse (the `::after` opacity halo currently on `.dotUnread` moves here). The urgent state is the one that moves. |
| `turn-complete` / `needs-input (idle)` — collapsed into one "your move" state | **Solid accent dot with STATIC glow** (existing `.dotUnread` look but the animated pulse removed — steady `box-shadow` only). Calm: your move, no rush. |
| idle / agent gone / no agent | Hollow grey dot — unchanged |
| visible session | Never signals — unchanged rule |

Semantic logic: hollow grey = empty; **hollow accent = an open question waiting
for YOU to fill**; solid accent = a finished turn delivered. Priority when a
session has multiple panes: `permission > turn-complete > working > idle`
(today's "unread trumps working" generalized).

Reduced motion: the blocked ring keeps its static accent ring (still
distinguishable by hollowness alone — shape, not motion, is the
discriminator). Same fallback-literal rule as existing dots: never a bare
`var()` in these styles (see the NOTE in `SessionRow.module.css`).

Two semantics locked during the 2026-07-02 review pass (implemented in
commit `92cefe7`):

- **`your-move` acknowledges on view** — a turn that completes while its
  session is visible lands as calm idle, and a lit your-move calms the
  moment its session is viewed. This is the agent-phase mirror of
  `activateSession`'s `unread = false`; without it an untouched Claude at
  its prompt would keep a dot lit forever (dot fatigue). **Permission is
  exempt**: a still-blocked agent is still urgent whether or not you looked.
- **`permission` exits on sustained output** — approving a permission
  prompt fires no hook event until the turn's `Stop`, so a permission-
  blocked pane is the ONE agent-owned pane that still listens to output:
  two chunks within `SUSTAIN_MS` (the same gate that filters idle-TUI
  repaints) demote it to `working`. Fails toward the calmer state; the
  next exact event corrects any mistake.

### Agent identity glyph

Glyph **after the session name**: Claude `✻`, Codex `›`, Gemini `✦` — the
same glyphs the website/video already use. It answers "which agent lives
here"; the indicator on the left keeps all attention color/motion.

Extended 2026-07-02 (operator-directed, commit `48b5991`):

- **Identity beyond hooks — launch-command detection.** The command-capture
  seam (the same prompt-gated capture that powers session restore) classifies
  a launch line via `agentIdentity.ts` (`claude`/`codex`/`gemini`, incl.
  runner forms like `npx @openai/codex`). Command-derived identity is
  **glyph-only**: `source: "command"`, phase `idle`, never class-A ownership —
  heuristics keep driving signals for those panes. A hook event upgrades it
  (`source: "hook"`); OSC 133 command-finished clears only command-sourced
  entries. Unrecognized commands stay glyph-less on pure heuristics.
- **Multiple agents side by side.** `sessionAgentView` returns every distinct
  agent in pane-tree order; a session running Claude + Codex shows `✻ ›`.
  The most-urgent pane's agent (`signalAgent`) names the tooltip reason.
- **Muted brand tints, not full saturation.** Claude `#c98a6d` (clay), Codex
  `#9aa5b1` (silver), Gemini `#7d9fd4` (blue) — literals (brand doesn't
  theme), deliberately desaturated so the accent stays the only loud color
  in the list. Ctrl+? Signals legend documents the glyph key.

### Roll-ups (nothing needing you is ever hidden)

- **Collapsed group header** inherits the most-urgent child signal
  (`permission > turn-complete > working`), rendered as a small indicator
  beside the folder name (`SessionGroup.tsx`).
- **Status bar, right segment**: needs-you roll-up — e.g. `◎1 ●2`
  (1 blocked, 1 your-move) next to the existing `⏵ N`. Informational in this
  plan; click-to-jump is future routing work.

### Legibility ("what dot is what")

- Every indicator gets a tooltip with the exact reason: "Claude — waiting on
  permission", "Claude — turn complete", "working", "idle".
- The Ctrl+? shortcuts modal gains a small **Signals legend** listing the
  four indicators with one-line meanings — the durable answer to "what does
  this dot mean" without leaving the app.
- Accessibility: the indicator `<span>` is currently `aria-hidden`; give the
  row an `aria-label`/`title` that includes the state name so the signal is
  not color/shape-only.

## Implementation order

0. **Spike (STOP gate):** hand-write the hook entries into
   `~/.claude/settings.json`, set `LUME_PANE_ID` manually in a shell, run
   `claude`, confirm: (a) hook fires on all five events; (b) hook process
   sees `LUME_PANE_ID` under both Git-Bash and PowerShell hook shells — the
   docs note hooks may get a *minimal isolated environment*, and if the tag
   does NOT survive, fall back to `CLAUDE_ENV_FILE` persistence via a
   SessionStart hook, or worst-case cwd matching (and record which in this
   file); (c) spool append works from both shells; (d) WSL: `WSLENV`
   carries the tag through; (e) `"async": true` accepted by the installed
   Claude Code version. **STOP if (a) or (b) fails with no workaround —
   the plan's exactness claim dies there.**
1. Pane tagging in `pty.rs` (+ WSLENV merge) + unit tests mirroring the
   existing `build_command` env tests.
2. `agent_events.rs` watcher + `agent-event` emission + sweep. Rust unit
   tests for offset-tracking/parse; manual smoke via `echo >> spool`.
3. `agentTracker.ts` state machine + attentionTracker class-A integration.
   Vitest state-machine table tests (event sequence → expected pane state),
   including out-of-order and unknown-event tolerance. **Pinned event
   contract** (so front/back can be built against it): Tauri event
   `agent-event` with payload `{ paneId: string, event: "SessionStart" |
   "UserPromptSubmit" | "Stop" | "Notification" | "SessionEnd", kind?:
   "permission_prompt" | "idle_prompt" | string, sessionId?: string,
   transcriptPath?: string, cwd?: string }`. Unknown `event`/`kind` values
   must be tolerated silently (forward compatibility).
4. UI per the locked Design section: `SessionRow` blocked-ring + calm-dot
   states, pulse moved to blocked, agent glyph after name, `SessionGroup`
   collapsed-header roll-up, StatusBar needs-you roll-up, tooltips,
   Signals legend in the shortcuts modal, aria-labels. Component tests where
   the repo already has them (SessionsSidebar.test.tsx pattern).
5. Hook install/uninstall in settings (atomic write, additive merge,
   marker-based removal) + Settings UI toggle. Tests: merge/unmerge
   round-trip fixtures including a settings.json with pre-existing foreign
   hooks.
6. Docs: CONTEXT.md gains "Agent Session" language + the signal glossary;
   README feature note; CHANGELOG entry.

Phase 3 (separate follow-up): same pattern for Codex (`~/.codex/hooks.json`,
map `PermissionRequest`→permission, `Stop`→turn-complete); process-name
identity scan (Toolhelp32 walk already exists in `is_pty_busy`) so unhooked
agents at least get the right glyph while keeping heuristic state.

## Risks & mitigations

- **Hook env isolation** (docs hedge on full env inheritance): spike step 0
  settles it; two documented fallbacks.
- **User edits/breaks settings.json**: atomic writes; parse failures at
  install → toast + abort, never write a file we couldn't parse.
- **Two Lume instances**: pane ids are remapped fresh per run and spool
  files are per-pane; boot sweep only deletes files older than the current
  boot for panes we don't own.
- **Claude Code version drift** (matcher names, async flag): tolerate
  unknown events/matchers silently; the settings-UI "no SessionStart seen"
  warning is the canary.
- **Enterprise policy disables hooks**: feature degrades to today's
  behavior; the toggle reports it.

## Out of scope (explicitly)

- OS notifications, sounds, taskbar badges (next plan; gated on this one).
- Transcript JSONL parsing / fleet dashboard enrichment.
- Gemini/aider support (no verified hook mechanism; they stay heuristic).
- Any change to the heuristic tiers' behavior for non-agent panes.
