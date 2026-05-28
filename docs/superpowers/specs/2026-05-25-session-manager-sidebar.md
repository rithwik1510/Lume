# Session Manager Sidebar — Design Spec

**Date:** 2026-05-25
**Status:** Approved (brainstorm) — awaiting plan
**Tracks:** v0.2 product improvement (brings forward the v0.3 "Dashboard sees panes across Tabs" dependency)

---

## 1. Goal

Replace the file-tree sidebar with a cmux-style session manager. A *session* is a saved, named workspace tied to a folder, with its own pane tree, its own set of running PTYs, and a small strip of polled metadata (git branch, status, unread).

The model gives the app a memory of projects — closing the app and reopening a week later shows the same list of sessions, each one click away from resuming work. Switching between sessions during a single run is instant because background sessions stay alive (PTYs running, xterm canvases preserved).

This is the destination DESIGN.md already pointed to (line 22: *"v0.3 — Dashboard view showing every running pane across all **Tabs**"*). "Tabs" plural was the spec implying multi-session; the sidebar is the navigator, and the v0.3 Dashboard will be the overview onto the same data.

## 2. Scope

### In scope (v1 of this feature)

- New `sessionsStore` with multi-named-per-folder sessions
- Sidebar list of sessions with status dot, name, folder basename, git branch
- "+ New session" entry point in sidebar + reuse of existing Open Folder button on topbar
- Three distinct entry points for session creation / activation (topbar Open Folder = "go to project"; sidebar `+ New session` = "new work-stream"; per-group `+` = "add session to this project")
- xterm survival on session switch (background PTYs stay alive)
- Cold-start = all sessions stopped; explicit click revives
- Stop-but-remember close semantics + hover-trash for purge
- File tree relocates to a secondary collapsible drawer, scoped to the active session
- Git branch polling (`git rev-parse --abbrev-ref HEAD` every 5s on focus + on revive)
- OSC 9 / 99 / 777 notification handlers → unread dot on sidebar row
- New shortcuts: `Ctrl+Shift+T`, `Ctrl+Tab` / `Ctrl+Shift+Tab`, `Ctrl+1`..`Ctrl+9`
- Status bar updated to show active session name
- Persistence migration: existing single-tree users get one auto-created session for their home dir

### Out of scope (deferred to v1.1 / v1.2 / v0.3 proper)

- Listening-ports column (Win32 `GetExtendedTcpTable` per pid)
- PR status (requires GitHub auth)
- Last-output snippet preview
- Per-pane cwd persistence (would require shell-pid cwd polling)
- Drag-to-reorder sessions in sidebar
- Embedded WebKit browser pane
- Native OS desktop notifications (in-app unread dot only for v1)
- Notification ring around the actual pane (just sidebar dot in v1)
- v0.3 Dashboard view (cards of every pane across sessions)

## 3. Locked decisions (from brainstorming Q&A)

| Question | Decision |
|---|---|
| How tightly is a session tied to a folder? | **Multi-named per folder.** UUID identity + folder ref + user-given name. Multiple sessions for the same folder allowed; Open Folder shows a "switch or new" picker when matches exist. |
| What happens when user closes a session (X)? | **Stop but remember.** PTYs killed (with busy-confirm gate); row stays dimmed in sidebar; hover-trash purges forever. Single sidebar list with status dots — no two-section split. |
| Cold start: which sessions auto-revive? | **None.** All sessions begin stopped. User explicitly clicks each one to revive. PTYs respawn at session's `folderPath`. |
| How rich is each session row? | **Grouped-tree layout** (revised 2026-05-25 from user mock). Sidebar groups sessions by their folder — group header carries the project label, sessions sit underneath. Per row: status dot (active / stopped / unread) · session name. Folder basename moves to the group header; git branch moves to the status bar. |
| File tree's new home (my call) | **Second collapsible drawer beside the sessions sidebar**, toggled by the existing `☰` button on the topbar. Scope = active session's `folderPath`; per-session toggle preference remembered. |
| layoutStore migration (my call) | **Façade pattern.** `layoutStore` actions delegate to `sessionsStore.sessions[activeId].layoutRoot`. Minimizes diff to every existing consumer; consolidate later if it gets awkward. |

## 4. Data model

```ts
// src/store/sessionsStore.ts

type SessionId = string;  // UUID v4

interface Session {
  id: SessionId;
  name: string;                    // user-editable; defaults to folder basename, auto-suffixed if duplicate
  folderPath: string;              // absolute path
  layoutRoot: LayoutNode | null;   // pane tree (persists across restart; null = no panes yet)
  focusedPaneId: PaneId | null;
  status: "active" | "stopped";    // derived this-run-only; NEVER persisted
  unread: boolean;                 // OSC notification set; cleared on activate
  gitBranch: string | null;        // polled; null when not a git repo or not yet polled
  fileTreeOpen: boolean;           // per-session file drawer toggle
  createdAt: number;               // ms epoch
  lastActiveAt: number;            // ms epoch; bumped on activate
}

interface SessionsState {
  sessions: Record<SessionId, Session>;
  activeSessionId: SessionId | null;          // null when no session is active (cold start, all-stopped)

  // Grouped-sidebar state. Groups are derived: every distinct `folderPath`
  // across `sessions` forms a group. No separate Group entity — just label
  // overrides and collapsed-state, keyed by folderPath.
  groupLabels: Record<string, string>;        // folderPath -> user-given label (overrides basename)
  collapsedGroups: string[];                  // folderPaths that are collapsed in the sidebar
}
```

### 4.1 Derived ordering (v1)

Within a group: sessions sorted by `lastActiveAt` desc — most recent work-stream first.

Between groups: each group's "recency" is the max `lastActiveAt` among its sessions; groups are sorted by that value desc — the project you're currently working in floats to the top. Empty groups (after every session in them is purged) cease to exist.

`groupLabels` and `collapsedGroups` are user-state, persisted. No explicit `order` field for v1; drag-to-reorder (with persisted explicit ordering) is v1.1.

## 5. Store architecture

### 5.1 New: `src/store/sessionsStore.ts`

Owns `SessionsState`. Actions:

| Action | Purpose |
|---|---|
| `createSession(folderPath, name?)` | New session. Name defaults to `"New session"`, auto-suffixed (`-2`, `-3`, …) on collision with siblings under the same `folderPath` (sibling-scoped, not global). Status = `"stopped"` initially. Caller typically follows with `activateSession`. |
| `activateSession(id)` | Sets `activeSessionId = id`, status → `"active"`, bumps `lastActiveAt`, clears `unread`. Pure data change — PTY spawning happens as a *side effect* of React mounting the now-visible `PaneTree` (see §9.3). |
| `stopSession(id)` | Status → `"stopped"`. If `id === activeSessionId`, clear `activeSessionId`. Pure data change — PTYs die as a side effect when `<MainArea>` drops the session from its active-filter and `TerminalPane`'s unmount cleanup calls `disconnectPty`. |
| `purgeSession(id)` | Removes from `sessions` map. If session was active, MainArea drops it → PaneTree unmounts → PTYs die (same chain as `stopSession`). If session was already stopped, no PTY side effect. If this was the last session in its group, the group implicitly disappears (groups are derived). |
| `renameSession(id, name)` | Updates `name`. Empty name reverts to default (`"New session"` + sibling-suffix). |
| `setGroupLabel(folderPath, label)` | Updates `groupLabels[folderPath]`. Empty label removes the entry (group reverts to basename). |
| `toggleGroupCollapsed(folderPath)` | Adds/removes `folderPath` from `collapsedGroups`. |
| `purgeGroup(folderPath)` | Convenience: purge every session in this group. UI confirms first. |
| `bumpUnread(id)` | Sets `unread = true`. No-op if `id === activeSessionId`. |
| `clearUnread(id)` | Sets `unread = false`. |
| `updateBranch(id, branch)` | Sets `gitBranch`. |
| `setLayoutRoot(id, root)` | Updates `layoutRoot` (used by the layoutStore façade on splits/closes). |
| `setFocusedPane(id, paneId)` | Updates `focusedPaneId`. |
| `toggleFileTree(id)` | Flips the session's `fileTreeOpen`. |
| `sessionsForFolder(path)` | Selector. Returns sessions matching `folderPath` (case-insensitive on Windows), sorted by `lastActiveAt` desc. |
| `groupedSessions()` | Selector. Returns `Array<{ folderPath, label, collapsed, sessions: Session[] }>` — the sidebar's render input. Groups derived from distinct `folderPath`s, sorted by max-child-`lastActiveAt` desc; sessions within each group sorted by `lastActiveAt` desc. Empty groups (no sessions) omitted. |
| `findSessionForPane(paneId)` | Selector. Walks each session's `layoutRoot` to find the pane. Used by OSC handler. |

### 5.2 Modified: `src/store/layoutStore.ts`

Becomes a **thin façade** over `sessionsStore.sessions[activeId].layoutRoot`:

- `useLayoutStore.splitPane(...)` → reads activeId from sessionsStore → writes via `sessionsStore.setLayoutRoot` after computing the new tree
- `useLayoutStore.closePane(...)`, `resizeSplit`, `focusPane`, `moveFocus` — same pattern
- `useLayoutStore.root` becomes a computed selector returning `sessions[activeId]?.layoutRoot ?? null`
- `useLayoutStore.focusedPaneId` returns `sessions[activeId]?.focusedPaneId ?? null`

This means every existing consumer (`PaneTree.tsx`, `useKeyboardShortcuts.ts`, `StatusBar.tsx`, `App.tsx`) keeps working with **zero code change at the call sites**. Actions land on the active session implicitly.

Edge case: when `activeSessionId === null`, every layout action is a no-op. Consumers must handle the null-root case (most already do — that was the case during cold-start before W4).

### 5.3 No change: `src/terminals/ptyClient.ts` and `src-tauri/src/pty.rs`

PTYs are already keyed by `paneId` in a global registry, independent of session. No code change required. Pane IDs need to remain globally unique across sessions — the existing counter in `src/lib/paneIds.ts` already guarantees this.

## 6. Sidebar UI

Reference: user-supplied screenshot of the cmux-derived grouped layout (Newidea / Vibe level work / Workflow / etc.). The sidebar is a **two-level tree**: project groups at the top level, sessions nested underneath. No per-row folder badge or branch column — both are absorbed by the group header or pushed to the status bar.

### 6.1 `src/components/SessionsSidebar.tsx` (replaces current `Sidebar.tsx`)

Structure:

```
┌──────────────────────────────────────┐
│  + New session             ⋯ menu    │  ← top toolbar (button + overflow)
├──────────────────────────────────────┤
│  ▾ Newidea                       +   │  ← group header (caret · label · hover-+)
│    ○ Review codebase                 │  ← stopped session
│    ○ General coding session          │
│                                      │
│  ▸ Stock ai predictor                │  ← collapsed group (no children shown)
│                                      │
│  ▾ Vibe level work               +   │
│    ● Review project architecture …   │  ← active session (filled accent dot, bold)
│    ○ Pull latest code …              │
│    ○ Understand scoring engines      │
│    ◉ Review auto-refresh changes     │  ← stopped + unread (soft pulse)
│                                      │
│  ▾ Workflow                      +   │
│    ◉ Project handoff …               │
│    ○ Plan new project …              │
└──────────────────────────────────────┘
```

Top toolbar:

- `+ New session` button (full-width, hover bg): opens folder picker, goes through §7 flow.
- `⋯` overflow menu (right): future home for "Reveal all in Explorer", filter, sort options. v1 wires the menu but only ships a "Filter…" item that focuses an inline filter input (text-match across session names and group labels).

Sidebar body: scrollable list rendered from the `groupedSessions()` selector.

### 6.2 `src/components/SessionGroup.tsx`

Per group header, left to right:

- Caret (`▾`/`▸`) — clicking toggles `collapsedGroups` via `toggleGroupCollapsed(folderPath)`. Animated 90° rotation.
- Group label (`var(--font-ui)`, slightly smaller and dimmer than session rows, `var(--fg-2)`). Defaults to `basename(folderPath)`; overridden by `groupLabels[folderPath]` if present.
- Hover-revealed `+` icon (right-aligned) — adds a new session directly to this group's folder, **skipping the folder picker**. New session gets `name = "New session"` (sibling-suffixed if needed), inline-rename starts immediately.
- Right-click menu: **Rename group** (inline-edits the label) · **Reveal in Explorer** (opens `folderPath`) · **Collapse / Expand** · **Delete group** (confirm dialog, then `purgeGroup(folderPath)`).
- Tooltip on hover over the label: full `folderPath`.

When collapsed, the group's children are not rendered. Status dots are not aggregated to the header in v1 (so you can't see at-a-glance that a collapsed group has an unread session — that's a v1.1 polish: pull a small unread-count badge onto the collapsed header).

### 6.3 `src/components/SessionRow.tsx`

Per session row, left to right (indented under the group):

- Status dot (10px circle):
  - Filled `var(--accent)` when active
  - Hollow outline `var(--fg-3)` when stopped
  - Filled `var(--accent)` with a soft 1.5s pulse animation when stopped-with-unread
- Session name (`var(--font-ui)`, bold if active, color `var(--fg-0)` if active or unread / `var(--fg-2)` if plain stopped). Single line, ellipsized.
- Trash icon (right-aligned, `var(--accent-red)` on hover) — only visible on row hover.

Interactions:

- Single click anywhere on the row (except trash) → `activateSession(id)`. PTY spawning is the React side effect described in §5.1 + §9.3.
- Trash click → confirm "Delete session '<name>'? This cannot be undone." → `purgeSession(id)`.
- Right-click → context menu (**Rename** · **Reveal in Explorer** · **Delete**).
- Double-click on name → inline rename (controlled input replaces label until blur or Enter).
- Hover → row background `var(--bg-2)`; trash icon appears.

### 6.4 Empty state

When `sessions` is empty (fresh install, no migration): centered prompt "No sessions yet." with two affordances: a primary `+ New session` button (opens picker) and a secondary "Open Folder" link (also opens picker — same flow, but matches the topbar wording).

## 7. Entry points for session creation / activation

Three distinct entry points, each with unambiguous semantics. No disambiguation popover needed — the grouped sidebar makes existing-sessions-for-this-folder visually obvious.

| Entry point | Semantic | Behavior |
|---|---|---|
| **Open Folder (topbar)** | "Go to this project" | Pick folder → if a group exists for this `folderPath`, activate its most-recently-active session. If no group exists, create one with a fresh session (named `"New session"`, status `"stopped"` until activated; activate immediately). |
| **`+ New session` (sidebar top)** | "Start a new work-stream" | Pick folder → always creates a new session. Lands in the matching group if `folderPath` already has sessions, else creates the group. New session gets `name = "New session"` (sibling-suffixed), inline-rename starts immediately on the new row. |
| **Per-group `+` (hover on group header)** | "Add another session to THIS project" | No folder picker — uses the group's existing `folderPath` directly. Creates a new session, inline-rename starts immediately. |

All three flows resolve into a single internal helper `createAndActivateSession(folderPath, name?)`:

```ts
function createAndActivateSession(folderPath: string, name?: string) {
  const id = sessionsStore.createSession(folderPath, name);
  sessionsStore.activateSession(id);  // PTY spawn cascades via React mount
}
```

The "Open Folder = switch" semantic uses a different internal helper:

```ts
function openFolder(folderPath: string) {
  const existing = sessionsStore.sessionsForFolder(folderPath);
  if (existing.length === 0) {
    createAndActivateSession(folderPath);
  } else {
    sessionsStore.activateSession(existing[0].id);  // most recent
  }
}
```

## 8. File tree relocation

### 8.1 Drawer placement

```
┌────────────┬────────────┬──────────────────────────┐
│  Sessions  │   Files    │      Pane area           │
│  (200px)   │  (240px,   │                          │
│            │  toggled)  │                          │
└────────────┴────────────┴──────────────────────────┘
```

- Drawer is the existing `SidebarTree.tsx` content, repurposed.
- Default width 240px. Resizable in a future iteration; fixed for v1.
- When `fileTreeOpen` is false, the drawer doesn't render — pane area expands.

### 8.2 Toggle mechanism

- The existing `☰` button in the topbar's left cluster (currently no-op) becomes the file tree toggle. Reads/writes `sessions[activeId].fileTreeOpen`.
- Active state highlight (accent border) when drawer is open.

### 8.3 Watcher subscription

- The file watcher subscribes to `sessions[activeId].folderPath` whenever the drawer is open.
- On session switch (with drawer open), tear down old watcher, subscribe to new folderPath. Reuses the existing noise-pattern filter and 300ms coalesce from `Sidebar.tsx`.
- On drawer close, tear down watcher entirely.

### 8.4 Filter / new-file affordances

The `🔍 filter` input and `＋ New File` button from the current `Sidebar.tsx` move into the drawer's header (same layout, just inside the drawer instead of the sidebar). `＋ New File` creates a `.md` file at the active session's `folderPath` and opens it in MD Editor.

## 9. xterm survival on session switch

### 9.1 Mount model

`App.tsx`'s main area renders a `<MainArea>` component that maps over **every session whose status is `"active"`** and renders a `<PaneTree>` for each. CSS:

```tsx
<div className={styles.mainArea}>
  {activeSessions.map((s) => (
    <div
      key={s.id}
      className={styles.sessionPaneTree}
      style={{ display: s.id === activeSessionId ? "block" : "none" }}
    >
      <PaneTree node={s.layoutRoot} path={s.id} />
    </div>
  ))}
</div>
```

### 9.2 Why this works

- xterm `Terminal` instances live in a module-level `Map<paneId, Terminal>` keyed by paneId (existing — see `TerminalPane.tsx`).
- Each `Terminal` is attached to a host `<div>` once. The `<div>` stays in the DOM across session switches (only `display` toggles).
- PTY streams (from `pty.rs` via `Channel<T>`) keep writing into the `Terminal`'s buffer regardless of `display`. Scroll position, alt-screen state, colors are preserved.
- WebGL canvas: `display: none` doesn't trigger WebGL context loss in any current browser engine / Tauri webview. Verified design choice; spike confirms.

### 9.3 Stopped sessions are not mounted

The `activeSessions.map` filter is `status === "active"`. Stopped sessions don't get a PaneTree, don't consume xterm Terminals, don't pin PTYs. Revive flow:

1. `activateSession(id)` flips status to `"active"`
2. Re-render: `<MainArea>` now includes that session's `<PaneTree>`
3. `<TerminalPane>` for each leaf mounts → `connectPty(paneId, cwd: folderPath)` spawns a fresh PTY in pty.rs
4. xterm Terminal is created fresh (no prior instance in the Map for the new paneIds), wired to the new PTY channel

**Note:** On revive, the paneIds in `layoutRoot` are the SAME ones that were persisted from last run. Because the global counter in `paneIds.ts` is reservation-aware (`reservePaneIdsAtLeast`), the counter will be pushed past any persisted IDs to avoid collision with new splits. But the persisted IDs themselves are reused for the revived layout's leaves.

### 9.4 Memory budget

Worst case: 8 active sessions × 4 panes × 10k scrollback ≈ 80MB for xterm + ~2MB per PTY process = ~120MB additional. Within budget for a workstation app.

## 10. New subsystems

### 10.1 Git branch poller (`src/sessions/branchPoller.ts`)

- Module-level interval (5 seconds while the app window has focus; paused via `tauri::AppHandle` focus events when blurred).
- On each tick, iterates over `sessions` whose `status === "active"`, runs `git rev-parse --abbrev-ref HEAD` against `folderPath` via a Tauri command.
- New Rust command `git_current_branch(path: String) -> Option<String>`. Invokes `git` as a subprocess; returns `None` on any error (not a git repo, missing git binary, deleted folder, detached HEAD).
- Result diffed against current `gitBranch`; if different, calls `sessionsStore.updateBranch(id, branch)`.
- Additional triggers: `activateSession` also fires an immediate poll for that session.

### 10.2 OSC notifications (`src/sessions/oscNotifications.ts`)

- On each `TerminalPane` mount, registers three xterm parser handlers via `term.parser.registerOscHandler(N, handler)`:
  - `OSC 9` — iTerm2 "notification" / Apple Terminal alert convention. Format: `ESC ] 9 ; <text> BEL`
  - `OSC 99` — KDE Konsole notification
  - `OSC 777` — rxvt "notify" extended convention
- All three handlers do the same thing: look up the session for the paneId via `findSessionForPane`, call `bumpUnread(sessionId)`.
- v1 visible effect: the sidebar row's status dot becomes `unread` (accent + soft pulse animation). Cleared by activating that session.
- v1.1: notification ring around the actual pane. v1.2: native OS desktop toast.

## 11. Persistence

### 11.1 Slice

New `sessions` slice on the existing `tauriPersistStorage` adapter (writes to `workstation-store.json`).

Persisted (partializer allowlist):

- Top-level: `groupLabels: Record<string, string>`, `collapsedGroups: string[]`
- Per session: `id`, `name`, `folderPath`, `layoutRoot`, `focusedPaneId`, `gitBranch`, `fileTreeOpen`, `createdAt`, `lastActiveAt`

NOT persisted:

- `status` — always derived to `"stopped"` on launch (per cold-start decision)
- `unread` — transient, cleared on quit
- `activeSessionId` — always `null` on launch (no auto-revive)

### 11.2 Rehydration

`onRehydrateStorage` runs after disk read:

- Coerce every session's `status` to `"stopped"` and `unread` to `false`
- Coerce `activeSessionId` to `null`
- Drop `groupLabels` entries and `collapsedGroups` entries whose `folderPath` no longer has any sessions
- Validate `folderPath` exists on disk (cheap stat) — if missing, mark `gitBranch = null` but keep the session (user might be on a different drive; we don't auto-purge)

### 11.3 Migration from v0.1

On first launch after this feature ships, if `workstation-store.json` has no `sessions` key (regardless of whether the old `layoutStore.root` key still exists):

1. Read the old `layoutStore.root` (if non-null) and `sidebarStore.workspaceFolder` (if non-null)
2. Create one session: `name = "New session"`, `folderPath = workspaceFolder || homeDir`, `layoutRoot = old layoutRoot`, `fileTreeOpen = true` (matches current single-tree UX)
3. The session lands in a group keyed by its `folderPath`; group label defaults to basename. Group starts expanded (no entry in `collapsedGroups`).
4. Wipe the old `layoutStore.root` key from persistence so the migration doesn't re-run

After migration, users see one stopped session under one project group with their old layout, one click away from reviving. No data loss.

### 11.4 Persistence model — what we save vs. don't save (the contract)

This section makes the persistence contract explicit, because the terminal-session model differs fundamentally from a chat-GUI model and the difference deserves to be on record.

**The fundamental shape:** Chat GUIs persist *data at rest* — message rows in a database, replayed verbatim on click. Terminal sessions involve a *live process* (a shell plus whatever programs it spawned), and a Unix process cannot be put in a JSON file. We persist the **container** (project, layout, naming); we do not persist the **contents** (in-flight process state).

#### What we save

| Field | Survives app restart? | Notes |
|---|---|---|
| Session id, name | yes | UUID + user label |
| `folderPath` | yes | absolute path; project identity |
| `layoutRoot` (tree shape) | yes | where panes / splits are |
| `focusedPaneId` | yes | restored on revive |
| `gitBranch` (cached) | yes | refreshed via poller on revive |
| `fileTreeOpen` | yes | per-session drawer state |
| `createdAt`, `lastActiveAt` | yes | for ordering and recency |
| `groupLabels`, `collapsedGroups` | yes | sidebar grouping state |

#### What we do NOT save (lost on app restart)

| Field | Why not |
|---|---|
| Live PTY process | DESIGN.md §1 invariant 5 — PTYs do not survive process restart. Killing app = killing every child shell. |
| Per-pane CWD (the `cd`'s the user did inside the shell) | Not polled in v1. On revive every PTY spawns at the session's `folderPath`. v1.1 candidate via OSC 7 shell hook. |
| Terminal scrollback / output history | Not snapshotted in v1. Revived panes start with an empty xterm buffer. v1.2 candidate via xterm `serialize` addon. |
| In-flight program state (vim buffers, claude code in-progress turn, build output, REPL state) | These belong to the programs, not to us. We are a terminal host, not a process container. See "What persists itself" below. |
| `activeSessionId` | Always `null` on launch. Cold-start = all sessions stopped (per §3 locked decision). |
| `status` field | Always coerced to `"stopped"` on launch. |
| `unread` flag | Transient; cleared on quit. |

#### What persists itself (not our concern)

The user's actual work mostly lives in the tools they run inside our terminals. When we revive a session, these come back independently because they were never ours to lose:

- **Shell history** → `~/.bash_history`, `~/.zsh_history`, PowerShell `PSReadLine` — survives. `Ctrl+R` works as expected after revive.
- **Claude Code conversations** → `~/.claude/projects/<hash>/...` — survives. Reviving a session and re-running `claude code` offers to resume the previous conversation through Claude Code's own resume feature.
- **Codex / aider / other agent state** → in those tools' own storage — survives.
- **Vim swap files** → `~/.vim/swap` and equivalents — survives, even across crashes.
- **tmux state** → tmux's own daemon, if the user runs tmux inside our shell — survives independently of our app.
- **Git working tree** → on disk — survives.

The implication: a user who quits the app mid-Claude-Code-session and revives the session tomorrow can run `claude code` in the revived pane and pick up where they left off. The conversation isn't ours to keep, and that's the right division of labor.

#### What "revive" actually means

User clicks a stopped session row → the session's layout shape comes back, the panes lay out as they were, fresh PTYs spawn at the session's `folderPath`. The user is back in the right project with the right window arrangement, ready to re-launch whatever they were running.

It is "open the project again, with the windows arranged how I left them" — not "reattach to the work in progress". The latter (true PTY survival across app restart) would require a separate daemon process that owns the PTYs — the tmux model. That's a v2-class architectural decision and explicitly out of scope.

#### Parity check: this matches cmux

cmux's PTYs also do not survive cmux quitting. cmux is an app, not a daemon. Its persistence contract is the same shape as ours: project list + workspace metadata, fresh shells on relaunch. cmux's edge is in-app session switching (background PTYs stay alive while the app is running), and that's exactly what §9 ("xterm survival on session switch") covers.

#### Future tiers (not v1)

| Tier | What it adds | Approach |
|---|---|---|
| **v1.1** | Per-pane CWD persistence | OSC 7 sequence emitted by shell hooks, parsed in xterm, stored on the LayoutNode leaf. Spawn PTY with that cwd on revive. |
| **v1.2** | Scrollback snapshot (read-only history) | xterm `serialize` addon dumps buffer to disk on quit; restored as read-only history on revive. |
| **v2** | True PTY survival across app restart (tmux model) | Workstation-daemon process owns PTYs; app connects to daemon over local IPC. Quitting the app does not kill PTYs. Significant cross-platform architecture work. |

## 12. Status bar

The terminal-focus segment currently reads `shell · cwd`. New format: `<group label> / <session name> · <focused pane shell> · <git branch>`.

- Group label from `groupLabels[folderPath] ?? basename(folderPath)`
- Session name from `sessions[activeSessionId].name`
- Pane shell from existing `ptyClient.getShell(paneId)` or similar (already wired)
- Git branch from `sessions[activeSessionId].gitBranch` (rendered with a `` icon prefix; segment hidden when `gitBranch == null`). This is where branch lives now that the sidebar row dropped it.
- Pane cwd is **not** tracked per-pane in v1. The cwd column drops from the status bar entirely until per-pane cwd polling lands in v1.2.

## 13. Shortcuts (additions)

| Shortcut | Action |
|---|---|
| `Ctrl+Shift+T` | New session (opens folder picker → §7 `+ New session` flow) |
| `Ctrl+Tab` | Activate next session in the sidebar's flattened render order (groups + sessions, skipping group headers) — wraps |
| `Ctrl+Shift+Tab` | Activate previous session in the flattened render order — wraps |
| `Ctrl+1` .. `Ctrl+9` | Activate session at flattened index N-1 (skipping group headers) |
| `Ctrl+W` | Unchanged for panes; if last pane in active session, busy-confirm then `stopSession` (does NOT purge) |

Existing shortcuts (Ctrl+B sidebar toggle, Ctrl+K Ctrl+O Open Folder, Ctrl+? shortcuts modal) continue to work. `Ctrl+B` now toggles the **sessions sidebar**; the file tree drawer has its own toggle on the topbar `☰` button (and a future Ctrl+Shift+E or similar — not in v1).

## 14. Implementation sequencing

Rough phase outline; the writing-plans skill will turn this into an actionable plan with verification steps per phase.

1. **`sessionsStore` + `layoutStore` façade.** Test-driven. Existing PaneTree keeps working but now reads via active session. No UI change.
2. **xterm survival mux.** `<MainArea>` renders all active sessions with display:none gating. Manual verify: split panes don't lose canvas / scroll on programmatic activeSessionId switch.
3. **Sidebar rebuild.** `SessionsSidebar` + `SessionGroup` + `SessionRow` + three-entry-point creation flow (§7) + inline rename (group label and session name) + right-click context menus + trash purge + collapse/expand groups.
4. **File tree drawer relocation.** Repurpose `☰` button; per-session toggle; watcher resubscription on session switch.
5. **Git branch poller** (Rust command + JS poller).
6. **OSC notification handlers** (three handlers per TerminalPane).
7. **New shortcuts + status bar update.**
8. **Persistence + v0.1→v0.2 migration.**

Each phase ends in a code-review pass (per user's preference established during W3/W4) before moving to the next.

## 15. Open risks

1. **xterm canvas memory at scale.** If a user accumulates 20+ active sessions in one run, WebGL contexts pile up. WebGL has a per-page context limit (typically ~16 in Chrome). Mitigation: when active-session count exceeds 8, the WebGL renderer for the LRU non-visible session degrades to the canvas renderer (xterm supports this fallback). v1.1.
2. **OSC handler ordering.** xterm may have built-in handlers for OSC 9 (window title in some configs). `registerOscHandler` returns a disposer and stacks LIFO. Need to confirm our handler fires before any built-in absorbs the sequence. Spike during phase 6.
3. **Folder-picker on UNC paths.** `git rev-parse` on a network path can hang for seconds. Mitigation: wrap the Rust command with a 2s timeout and treat timeout as `gitBranch = null`.
4. **Migration edge case.** A user who has persisted `layoutStore.root` but no `sidebarStore.workspaceFolder` (e.g. wiped their store partially) needs `folderPath = homeDir` fallback. Covered in §11.3.
5. **Last-pane-in-session ambiguity.** Today, last pane is a hard floor — you can't close it. New semantics: last pane in active session can close, which triggers `stopSession`. Confirm wording for the busy gate has to clarify this — proposed: *"This is the last pane in '<session>'. Closing it will stop the session (kept in sidebar for reactivation). Continue?"*

## 16. References

- DESIGN.md §1 (invariants), §3 (top bar / sidebar layout), §6 (config schema — no change here), §7 (shortcuts), §12 (persistence)
- CONTEXT.md "Workstation invariants" #3 (close-with-active-child confirm)
- Brainstorming Q&A: 2026-05-25 conversation
- cmux references: [GitHub](https://github.com/manaflow-ai/cmux), [cmux.com](https://cmux.com/)

---

## Appendix A — File-by-file change estimate

| File | Change | LoC est. |
|---|---|---|
| `src/store/sessionsStore.ts` | NEW | ~250 |
| `src/store/layoutStore.ts` | Rewrite as façade | ~180 (was 220) |
| `src/components/SessionsSidebar.tsx` | NEW (replaces Sidebar.tsx logic; top toolbar + grouped list + filter) | ~110 |
| `src/components/SessionGroup.tsx` | NEW (group header: caret, label, hover-+, context menu, collapse) | ~110 |
| `src/components/SessionRow.tsx` | NEW (dot, name, trash, inline rename, context menu) | ~110 |
| `src/components/FileDrawer.tsx` | NEW (extracted from Sidebar.tsx + SidebarTree.tsx wrapper) | ~80 |
| `src/components/MainArea.tsx` | NEW (display:none mux) | ~40 |
| `src/components/App.tsx` | Refactor for MainArea | ~30 delta |
| `src/components/TopBar.tsx` | ☰ button wired to toggleFileTree | ~20 delta |
| `src/components/StatusBar.tsx` | Session-aware focus segment | ~15 delta |
| `src/hooks/useKeyboardShortcuts.ts` | New shortcuts | ~50 delta |
| `src/sessions/branchPoller.ts` | NEW | ~80 |
| `src/sessions/oscNotifications.ts` | NEW | ~60 |
| Inline rename UX | Implemented as a controlled `<input>` swap inside SessionGroup / SessionRow (no separate text-input modal needed for v1) | (counted above) |
| `src-tauri/src/git.rs` | NEW (`git_current_branch` command) | ~50 |
| `src-tauri/src/lib.rs` | Register `git_current_branch` | ~5 delta |
| Tests | sessionsStore, layout façade, branchPoller, oscNotifications | ~300 |

Total: ~1450 LoC new + ~250 LoC delta. Roughly the size of W3.
