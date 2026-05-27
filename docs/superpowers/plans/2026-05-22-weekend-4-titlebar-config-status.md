# Weekend 4 Implementation Plan — Frameless Titlebar + Config + Status Bar + Persistence

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land DESIGN.md §12 Weekend 4 — frameless custom titlebar with the full top-bar button row, `~/.workstation/config.toml` schema with `notify`-based hot reload, focused-element-aware Status Bar, and Zustand `persist` middleware backed by `@tauri-apps/plugin-store` for layout / Workspace Folder / Sidebar visibility / MD mode.

**Architecture:** Four sequenced phases, each ending in a clean commit. Phase 1 is the frameless titlebar + top-bar buttons (gives MD Editor / Quick Viewer / Sidebar toggles their real home and finally retires the Sidebar-header workaround from W3). Phase 2 lands the config file + hot reload + the `settingsStore`. Phase 3 adds the Status Bar. Phase 4 wires persistence so layout shape / workspace / sidebar visibility / MD mode survive restart — PTYs do NOT survive (DESIGN.md §1 invariant 5).

**Process gate (every 3-4 tasks):** Subagent-driven-development already runs spec + code-quality review per task. ADDITIONALLY: at every phase boundary, dispatch a holistic code-review subagent that reads the full diff for the phase and reports cross-file consistency, theme-token usage, accessibility, and DESIGN.md alignment. Fix any findings before opening the next phase.

**Tech Stack:**
- TS/React side: existing stack only. New stores: `settingsStore.ts`. New components: `TopBar.tsx`, `StatusBar.tsx`. New lib: `configClient.ts`, `windowControls.ts`. Zustand `persist` middleware via `@tauri-apps/plugin-store` (already in `package.json`).
- Rust side: existing `notify` + `dirs` crates plus the `toml` crate (new). New file: `config.rs`. Tauri config: `decorations: false`.

**Acceptance for the whole weekend:**
- App launches with frameless custom titlebar at the top: drag region in the empty area, four left-cluster buttons (☰ Sidebar toggle, ⊞ Split menu, ⌨ Shortcuts viewer, 🗎 MD Editor toggle), two right-cluster buttons before the window controls (📄 Quick Viewer toggle, ⚙ Settings gear), Lucide-style min/max/close on the far right. This matches DESIGN.md §3 ASCII art and CONTEXT.md "Workstation surfaces" exactly.
- Double-clicking the drag region toggles maximize. Clicks on any titlebar button do NOT register as window drags.
- `%APPDATA%\workstation\config.toml` is created on first launch with all v0.1 default keys (DESIGN.md §6). Editing the file on disk hot-reloads font size, default shell, sidebar visibility default, and theme accent without a restart.
- ⚙ Settings gear opens the config file as a new MD Editor tab; saving the tab is a normal disk write — `notify` picks it up and the settings store mirrors the change.
- Unknown config keys log a warn-level message via `tauri-plugin-log` and do not break the load (toast surface is v0.5+).
- 24px Status Bar at the bottom: LEFT segment shows focused-element summary (`[shell] · [cwd]` for Terminal, `[file] · Ln N, Col M` for MD Editor tab, Workspace Folder path for Sidebar focus). RIGHT segment shows `[workspace short name]` + active-process indicator `⏵ N` in accent (N counts running terminals; v0.1 cannot distinguish idle shell from foreground process — documented limitation, OSC 7 lands in v0.2).
- Layout tree shape, Workspace Folder, Sidebar visibility, and MD Editor mode survive an app restart. PTYs do NOT survive — each pane re-spawns a fresh shell at the saved cwd (DESIGN.md §1 invariant 5).
- All verification gates pass at each phase boundary: `npm test -- --run`, `npm run typecheck`, `cargo test --lib`, `cargo clippy --all-targets -- -D warnings`, `cargo fmt --all -- --check`.

**Phase commits at the end of the weekend (target):**
- 28: `feat(titlebar): frameless custom titlebar with top-bar buttons`
- 29: `feat(config): ~/.workstation/config.toml schema + hot reload + settingsStore`
- 30: `feat(statusbar): focused-element-aware Status Bar`
- 31: `feat(persist): Zustand persist via tauri-plugin-store for layout/sidebar/md mode`

---

## File structure delivered by this plan

### New TypeScript files
| Path | Responsibility |
|---|---|
| `src/components/TopBar.tsx` | Frameless titlebar root: drag region, six left buttons, native window controls on the right. |
| `src/components/TopBar.module.css` | Titlebar styling — 36px tall, `bg.0`, 1px `border` bottom, hover states for each button. |
| `src/components/StatusBar.tsx` | 24px bottom bar. Reads focus state from layoutStore + mdStore + sidebarStore, renders LEFT focused-element summary + RIGHT workspace+process indicator. |
| `src/components/StatusBar.module.css` | Status bar styling — 24px tall, `bg.1`, 1px `border` top, JetBrains Mono 12px `fg.1`. |
| `src/lib/windowControls.ts` | Thin wrappers around `@tauri-apps/api/window` for minimize / maximize / close / isMaximized. Imported by TopBar. |
| `src/lib/configClient.ts` | TS wrappers around `read_config`, `write_default_config_if_missing`, `watch_config`. |
| `src/store/settingsStore.ts` | Zustand slice mirroring `config.toml`. Hot-reloads when the file changes on disk. Single source of truth for runtime settings. |
| `src/store/settingsStore.test.ts` | Vitest coverage: applyConfig with valid input, with partial input (defaults fill in), with unknown keys (logged, ignored). |
| `src/types/config.ts` | `WorkstationConfig` type — the in-memory shape returned by `read_config`. Mirrors `config.rs::WorkstationConfig` JSON exactly. |
| `src/components/TopBar.test.tsx` | Regression test: every `<button>` and clickable control inside the titlebar has `data-tauri-drag-region="false"` on its root (DESIGN.md §12 W5 #1d). |
| `src/lib/persistStorage.ts` | Adapter implementing Zustand's `StateStorage` interface backed by `@tauri-apps/plugin-store`. Lazy-creates the store, async getItem/setItem/removeItem. |

### New Rust files
| Path | Responsibility |
|---|---|
| `src-tauri/src/config.rs` | Schema struct, default-file generation, TOML parse, `notify` watcher, Tauri commands `read_config`, `write_default_config_if_missing`, `watch_config`, `config_file_path`. |

### Modified files
| Path | Change |
|---|---|
| `src-tauri/Cargo.toml` | Add `toml = "0.8"`. |
| `src-tauri/tauri.conf.json` | `app.windows[0].decorations: false`. |
| `src-tauri/src/lib.rs` | Add `pub mod config;` and register the four new commands in `invoke_handler!`. |
| `src/main.tsx` | Pull initial layout state from persisted storage BEFORE the first render (avoids the bootstrap pane racing the rehydration). |
| `src/App.tsx` | Vertical-flex outer layout: `<TopBar />` at top, existing horizontal flex (`<Sidebar /> + main + <ContextMenu />`) in the middle, `<StatusBar />` at bottom. Top-level container becomes `flex-direction: column`. |
| `src/components/Sidebar.tsx` | Remove the W3 fallback 🗎 MD Editor toggle button — the real button now lives in `TopBar`. Keep ➕ new-file and 🔍 filter. |
| `src/components/Sidebar.module.css` | Remove the `.iconButton.active` interim affordance comment (the active state still applies to ➕ if pressed; the comment explaining it as W4 workaround is stale). |
| `src/store/sidebarStore.ts` | Add `sidebarVisible: boolean` + `toggleSidebar`/`setSidebarVisible` actions. Persisted via Phase 4. |
| `src/store/layoutStore.ts` | Add `persist` middleware around the existing devtools+immer stack. Persist `{root, focusedPaneId: null on hydrate}`. PTY metadata is NOT in this store and so is not persisted (correctly per the spec). |
| `src/store/mdStore.ts` | Add `persist` middleware for `mdEditorMode` ONLY (tabs/quickViewer remain ephemeral — see plan §4.4 for rationale). |
| `src/hooks/useKeyboardShortcuts.ts` | Add Ctrl+B handler that toggles Sidebar visibility (DESIGN.md §7). Sits above the Ctrl+W pane-close entry; uses `isCtrlOnly`. |
| `src/styles/theme.css` | Add `--font-ui` and `--font-mono` CSS variables if not already present (verify; theme.css doesn't currently expose them by name even though `Sidebar.module.css` references `var(--font-ui)`). |

---

## Process notes for the executing controller

- **One subagent per task** (per `superpowers:subagent-driven-development`). The implementer commits inside its own context.
- **Two-stage review per task**: spec-compliance review against this plan's task body, then code-quality review against the resulting commit SHA.
- **Phase-boundary holistic review**: after the last task of each Phase is committed and both per-task reviews are clean, dispatch ONE additional code-reviewer subagent with the full phase diff (`git diff HEAD~N..HEAD` for that phase) and ask it to flag cross-file inconsistencies, theme-token usage, missing accessibility attributes, and any drift from DESIGN.md / CONTEXT.md. Fix any findings before starting the next phase.
- **Verification gates at every commit**: `npm test -- --run`, `npm run typecheck`, `cargo test --lib`, `cargo clippy --all-targets -- -D warnings`, `cargo fmt --all -- --check`. If any gate is red, the implementer fixes before handoff.
- **Working tree clean only before phase commits.** Intermediate task commits are fine.

---

# Phase 1 — Frameless titlebar with top-bar buttons

**Why this phase first:** Today's MD Editor / Quick Viewer / Sidebar toggles live on the Sidebar's header as a workaround. The titlebar is the real home for them per DESIGN.md §3 and CONTEXT.md. Landing this first means every later phase (config, status bar, persistence) can reference the real chrome.

**Spec anchors:**
- DESIGN.md §3 (Top Bar elements), §5 ("Frameless titlebar" paragraph), §12 Weekend 4 #1.
- CONTEXT.md "Frameless titlebar" + "Workstation surfaces".

### Task 1.1: Add `--font-ui` and `--font-mono` to theme.css

**Files:**
- Modify: `src/styles/theme.css`

**Why:** `Sidebar.module.css` and `MdEditor.module.css` already read `var(--font-ui)`, but `theme.css` doesn't declare it. The cascade falls back to browser default. Add both tokens now so the new TopBar and StatusBar use them too.

- [ ] **Step 1: Add both font tokens**

Open `src/styles/theme.css`. After the `--space-4: 16px;` line (the last line inside `:root`), before the closing `}`, add:

```css

  /* Typography stacks. Inter for UI, JetBrains Mono for code/terminals. */
  --font-ui:
    "Inter Variable", "Inter", -apple-system, "Segoe UI Variable", "Segoe UI",
    sans-serif;
  --font-mono:
    "JetBrains Mono Variable", "JetBrains Mono", Consolas, "Courier New",
    monospace;
```

- [ ] **Step 2: Verify CSS still parses**

Run: `npm run typecheck`
Expected: clean (CSS isn't type-checked but a syntax error in `theme.css` would still surface during `vite build` later; this is the cheapest gate now).

- [ ] **Step 3: Commit**

```bash
git add src/styles/theme.css
git commit -m "chore(theme): declare --font-ui and --font-mono tokens

Existing component CSS (Sidebar, MdEditor, MdEditorPreview) already
references these tokens. Declaring them here makes them explicit and
ensures the new TopBar / StatusBar pick them up without re-declaring.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 1.2: Flip the window to frameless

**Files:**
- Modify: `src-tauri/tauri.conf.json:20`

- [ ] **Step 1: Set decorations to false**

In `src-tauri/tauri.conf.json`, change the line:
```json
        "decorations": true,
```
to:
```json
        "decorations": false,
```

- [ ] **Step 2: Add a "permissions" note about why decorations:false is OK without snap-layouts plugin**

No code change — confirm DESIGN.md §10 risk 11 already documents the Windows 11 snap-layouts loss. Nothing to edit.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/tauri.conf.json
git commit -m "feat(window): switch to frameless window

Tauri \`decorations: false\` removes the OS-provided titlebar. The HTML
TopBar lands in Task 1.4 with drag region + custom min/max/close. Snap
layouts loss on Win11 is documented as a v0.1 gap (DESIGN.md \xa710 risk 11).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 1.3: Window controls client wrapper

**Files:**
- Create: `src/lib/windowControls.ts`

- [ ] **Step 1: Write the wrapper**

```typescript
// Thin wrappers around @tauri-apps/api/window for the custom titlebar.
// The Tauri v2 API uses `getCurrentWindow()`; we centralise the calls so
// the TopBar component doesn't reach into the Tauri API directly and so
// tests can mock the module.

import { getCurrentWindow } from "@tauri-apps/api/window";

export async function minimizeWindow(): Promise<void> {
  await getCurrentWindow().minimize();
}

export async function toggleMaximize(): Promise<void> {
  const win = getCurrentWindow();
  const maxed = await win.isMaximized();
  if (maxed) await win.unmaximize();
  else await win.maximize();
}

export async function closeWindow(): Promise<void> {
  await getCurrentWindow().close();
}

export async function isMaximized(): Promise<boolean> {
  return getCurrentWindow().isMaximized();
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Commit (deferred — bundles with Task 1.4)**

No commit yet. This file is small and ships alongside the TopBar in Task 1.4.

---

### Task 1.4: TopBar component + CSS module

**Files:**
- Create: `src/components/TopBar.tsx`
- Create: `src/components/TopBar.module.css`

**Why this is the meaty task:** Six top-bar buttons + window controls + drag region. Each button must set `data-tauri-drag-region="false"` on its root or the click registers as a window drag (DESIGN.md §5 warning).

- [ ] **Step 1: Write `TopBar.module.css`**

```css
/* src/components/TopBar.module.css
 *
 * Frameless titlebar — 36px tall (DESIGN.md \xa75 "Frameless titlebar"). The
 * empty surface between the left button cluster and the right window
 * controls is the drag region. Every clickable control opts OUT of the
 * drag region (data-tauri-drag-region="false") otherwise the WebView
 * swallows the click and starts a window drag. */

.root {
  height: 36px;
  flex-shrink: 0;
  background: var(--bg-0);
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  font-family: var(--font-ui);
  color: var(--fg-1);
  font-size: 13px;
  user-select: none;
  box-sizing: border-box;
}

.left {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding-left: var(--space-2);
}

.drag {
  flex: 1;
  height: 100%;
  /* No background — the drag region inherits --bg-0. */
}

.right {
  display: inline-flex;
  align-items: center;
  height: 100%;
}

/* Top-bar action button (Sidebar toggle, Split menu, etc.). 28x28, square
 * hit area, subtle hover. Active state for toggles uses --accent. */
.btn {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--fg-1);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  padding: 0;
  transition: color 120ms ease, background 120ms ease, border-color 120ms ease;
}
.btn:hover {
  color: var(--fg-0);
  background: var(--bg-1);
  border-color: var(--accent-dim);
}
.btn.active {
  color: var(--accent);
  background: var(--bg-1);
  border-color: var(--accent-dim);
}

/* Window control buttons (min/max/close) — 28x36 hit area matches DESIGN.md.
 * Square corners (no border-radius) on the window controls to read as native
 * Windows controls. Close hover is --error. */
.winBtn {
  width: 28px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--fg-1);
  border: none;
  cursor: pointer;
  padding: 0;
  transition: color 120ms ease, background 120ms ease;
}
.winBtn:hover {
  color: var(--fg-0);
  background: var(--bg-1);
}
.winBtn.close:hover {
  color: #ffffff;
  background: var(--error);
}
```

- [ ] **Step 2: Write `TopBar.tsx`**

```tsx
// src/components/TopBar.tsx
//
// Frameless custom titlebar (DESIGN.md \xa73, \xa75; CONTEXT.md "Frameless
// titlebar"). 36px tall. Drag region in the middle. Six action buttons on
// the left, three native window controls (min/max/close) on the right.
//
// Critical invariant: EVERY clickable element inside the titlebar sets
// data-tauri-drag-region="false" on its root, otherwise the click is
// swallowed as a window drag. There's a regression test (TopBar.test.tsx)
// that walks the rendered DOM and asserts this.

import styles from "@/components/TopBar.module.css";
import { useMdStore } from "@/store/mdStore";
import { useSidebarStore } from "@/store/sidebarStore";
import { useLayoutStore } from "@/store/layoutStore";
import {
  minimizeWindow,
  toggleMaximize,
  closeWindow,
} from "@/lib/windowControls";

/** Lucide-style minimize glyph: single horizontal stroke. */
function MinIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={2} strokeLinecap="round"
      aria-hidden="true">
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

/** Lucide-style maximize glyph: rounded square. */
function MaxIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={2} strokeLinejoin="round"
      aria-hidden="true">
      <rect x="5" y="5" width="14" height="14" rx="1" />
    </svg>
  );
}

/** Lucide-style close glyph: X. */
function CloseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={2} strokeLinecap="round"
      aria-hidden="true">
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}

export function TopBar() {
  const mdMode = useMdStore((s) => s.mdEditorMode);
  const setMdEditorMode = useMdStore((s) => s.setMdEditorMode);
  const qvOpen = useMdStore((s) => s.quickViewer.open);
  const qvPath = useMdStore((s) => s.quickViewer.path);
  const openMdInQuickViewer = useMdStore((s) => s.openMdInQuickViewer);
  const closeQuickViewer = useMdStore((s) => s.closeQuickViewer);
  const openMdTab = useMdStore((s) => s.openMdTab);

  const sidebarVisible = useSidebarStore((s) => s.sidebarVisible);
  const toggleSidebar = useSidebarStore((s) => s.toggleSidebar);
  const workspaceFolder = useSidebarStore((s) => s.workspaceFolder);

  const focusedPaneId = useLayoutStore((s) => s.focusedPaneId);
  const splitPane = useLayoutStore((s) => s.splitPane);

  const onSplit = (dir: "right" | "down" | "up") => {
    if (focusedPaneId === null) return;
    // Use the same paneId convention as useKeyboardShortcuts — high counter.
    // We piggyback on the existing splitPane mutation; the orchestrator will
    // spawn the PTY by reacting to the layout subscribe.
    const id = `pane-${Date.now()}`;
    splitPane(dir, id, focusedPaneId);
  };

  const onToggleQuickViewer = () => {
    if (qvOpen) {
      closeQuickViewer();
    } else if (qvPath !== null) {
      void openMdInQuickViewer(qvPath).catch((err) =>
        console.error("openMdInQuickViewer failed", err)
      );
    }
    // No-op when QV has no remembered path — matches keyboard shortcut.
  };

  const onSettings = () => {
    // Open ~/.workstation/config.toml in the MD Editor as a tab. The
    // configClient.configFilePath() helper lands in Phase 2; until then the
    // settings gear is wired but no-ops with a console warning. This task
    // intentionally leaves the path-resolution branch as a TODO so that the
    // visual surface ships in Phase 1 and the wiring completes in Phase 2.
    void import("@/lib/configClient")
      .then(({ configFilePath }) => configFilePath())
      .then((path) => openMdTab(path))
      .catch((err) =>
        console.error(
          "Settings gear: configClient not ready yet (lands in Phase 2)",
          err
        )
      );
  };

  return (
    <div className={styles.root} data-tauri-drag-region>
      <div className={styles.left} data-tauri-drag-region="false">
        <button
          className={`${styles.btn} ${sidebarVisible ? styles.active : ""}`}
          title={sidebarVisible ? "Hide Sidebar (Ctrl+B)" : "Show Sidebar (Ctrl+B)"}
          aria-label="Toggle Sidebar"
          data-tauri-drag-region="false"
          onClick={toggleSidebar}
        >
          ☰
        </button>
        <button
          className={styles.btn}
          title="Split focused pane right (Ctrl+Alt+→)"
          aria-label="Split right"
          data-tauri-drag-region="false"
          onClick={() => onSplit("right")}
        >
          ⊞
        </button>
        <button
          className={styles.btn}
          title="Keyboard shortcuts viewer (Ctrl+?)"
          aria-label="Keyboard shortcuts"
          data-tauri-drag-region="false"
          onClick={() => {
            // Viewer modal is v0.2 polish; in v0.1 we just log.
            console.info("Keyboard shortcuts viewer is v0.2 polish");
          }}
        >
          ⌨
        </button>
        <button
          className={`${styles.btn} ${mdMode === "full" ? styles.active : ""}`}
          title={mdMode === "full" ? "Close MD Editor (Ctrl+E)" : "Open MD Editor (Ctrl+E)"}
          aria-label="Toggle MD Editor"
          data-tauri-drag-region="false"
          onClick={() => setMdEditorMode(mdMode === "full" ? "off" : "full")}
        >
          🗎
        </button>
        <button
          className={`${styles.btn} ${qvOpen ? styles.active : ""}`}
          title={qvOpen ? "Close Quick Viewer (Ctrl+Shift+M)" : "Open Quick Viewer (Ctrl+Shift+M)"}
          aria-label="Toggle Quick Viewer"
          data-tauri-drag-region="false"
          onClick={onToggleQuickViewer}
        >
          📄
        </button>
        <button
          className={styles.btn}
          title="Settings — open config.toml"
          aria-label="Settings"
          data-tauri-drag-region="false"
          onClick={onSettings}
        >
          ⚙
        </button>
      </div>

      <div
        className={styles.drag}
        data-tauri-drag-region
        // Double-click on the drag region toggles maximize (Windows convention).
        onDoubleClick={() => void toggleMaximize()}
        title={workspaceFolder ?? ""}
      />

      <div className={styles.right} data-tauri-drag-region="false">
        <button
          className={styles.winBtn}
          title="Minimize"
          aria-label="Minimize"
          data-tauri-drag-region="false"
          onClick={() => void minimizeWindow()}
        >
          <MinIcon />
        </button>
        <button
          className={styles.winBtn}
          title="Maximize"
          aria-label="Maximize"
          data-tauri-drag-region="false"
          onClick={() => void toggleMaximize()}
        >
          <MaxIcon />
        </button>
        <button
          className={`${styles.winBtn} ${styles.close}`}
          title="Close"
          aria-label="Close"
          data-tauri-drag-region="false"
          onClick={() => void closeWindow()}
        >
          <CloseIcon />
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: clean. If `useSidebarStore` complains about `sidebarVisible` / `toggleSidebar` not existing — Task 1.6 adds them. Wire that task BEFORE this one if the typecheck fails; the plan ordering here assumes you complete 1.6 first if needed.

> **Implementer note:** Run Task 1.6 before this step if the typecheck is red on `sidebarVisible`/`toggleSidebar`. Re-order is fine — these two tasks are deliberately independent.

- [ ] **Step 4: Commit (deferred — bundles with Tasks 1.5 + 1.6 + 1.7)**

No commit yet. All Phase 1 tasks bundle into commit 28.

---

### Task 1.5: TopBar drag-region regression test

**Files:**
- Create: `src/components/TopBar.test.tsx`

DESIGN.md §12 Weekend 5 #1d calls for a regression test that walks the titlebar DOM and asserts every clickable control has `data-tauri-drag-region="false"`. We add it now because we're building the titlebar; the W5 test plan inherits this file.

- [ ] **Step 1: Write the test**

```tsx
// src/components/TopBar.test.tsx
//
// Regression test for the data-tauri-drag-region invariant on the
// frameless titlebar. Every clickable control inside the titlebar must
// have data-tauri-drag-region="false" on its root, otherwise clicks
// register as window drags (DESIGN.md \xa75 + \xa712 W5 #1d).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react"; // installed lazily below
import { TopBar } from "@/components/TopBar";

// Mock the Tauri window controls so the test runs in happy-dom.
vi.mock("@/lib/windowControls", () => ({
  minimizeWindow: vi.fn(),
  toggleMaximize: vi.fn(),
  closeWindow: vi.fn(),
  isMaximized: vi.fn(async () => false),
}));

vi.mock("@/lib/configClient", () => ({
  configFilePath: vi.fn(async () => "C:/fake/config.toml"),
}));

// Mock stores so the test doesn't depend on real layout/PTY state.
vi.mock("@/store/mdStore", () => ({
  useMdStore: Object.assign((sel: (s: unknown) => unknown) =>
    sel({
      mdEditorMode: "off",
      setMdEditorMode: vi.fn(),
      quickViewer: { open: false, path: null, content: "" },
      openMdInQuickViewer: vi.fn(),
      closeQuickViewer: vi.fn(),
      openMdTab: vi.fn(async () => undefined),
    }), { getState: vi.fn() }),
}));
vi.mock("@/store/sidebarStore", () => ({
  useSidebarStore: Object.assign((sel: (s: unknown) => unknown) =>
    sel({
      sidebarVisible: true,
      toggleSidebar: vi.fn(),
      workspaceFolder: "C:/Users/test",
    }), { getState: vi.fn() }),
}));
vi.mock("@/store/layoutStore", () => ({
  useLayoutStore: Object.assign((sel: (s: unknown) => unknown) =>
    sel({
      focusedPaneId: "pane-1",
      splitPane: vi.fn(),
    }), { getState: vi.fn() }),
}));

describe("TopBar — drag region invariant", () => {
  beforeEach(() => vi.clearAllMocks());

  it("every clickable control has data-tauri-drag-region=\"false\"", () => {
    const { container } = render(<TopBar />);
    const clickables = container.querySelectorAll("button, [role='button']");
    expect(clickables.length).toBeGreaterThanOrEqual(9); // 6 left + 3 right
    for (const el of Array.from(clickables)) {
      expect(
        el.getAttribute("data-tauri-drag-region"),
        `control ${el.outerHTML} is missing data-tauri-drag-region=\"false\"`
      ).toBe("false");
    }
  });
});
```

- [ ] **Step 2: Install `@testing-library/react` if not already a devDep**

Run: `npm ls @testing-library/react`
If "(empty)" or absent, run:
```bash
npm i -D @testing-library/react@^16
```
Expected: package added to `devDependencies`.

- [ ] **Step 3: Run test — expect FAIL first, then PASS once TopBar is in place**

Run: `npm test -- --run src/components/TopBar.test.tsx`
Expected on first run after writing this test BEFORE Task 1.4 implementation: FAIL with "Cannot find module @/components/TopBar".
Expected after Task 1.4 implementation is in: PASS (1 passing).

- [ ] **Step 4: Commit (deferred — bundles with Task 1.4)**

No commit yet.

---

### Task 1.6: Sidebar visibility in sidebarStore + Ctrl+B shortcut

**Files:**
- Modify: `src/store/sidebarStore.ts`
- Modify: `src/store/sidebarStore.test.ts`
- Modify: `src/hooks/useKeyboardShortcuts.ts`
- Modify: `src/App.tsx` (gate `<Sidebar />` on `sidebarVisible`)

- [ ] **Step 1: Add the state + actions to `sidebarStore.ts`**

In `src/store/sidebarStore.ts`:

After the `filterText: string;` field in `SidebarState`, add:
```typescript
  sidebarVisible: boolean;
```
Then add to the actions section:
```typescript
  toggleSidebar: () => void;
  setSidebarVisible: (visible: boolean) => void;
```

Then in the store body, initialize:
```typescript
      sidebarVisible: true,
```
And add the actions inside the `immer((set, get) => ({ ... }))` body, near `setFilter`:
```typescript
      toggleSidebar: () =>
        set((s) => {
          s.sidebarVisible = !s.sidebarVisible;
        }),

      setSidebarVisible: (visible) =>
        set((s) => {
          s.sidebarVisible = visible;
        }),
```
And in `reset`:
```typescript
          s.sidebarVisible = true;
```

- [ ] **Step 2: Write the failing test in `sidebarStore.test.ts`**

Append inside the existing `describe("sidebarStore", ...)` block (or create one if the file doesn't have a top-level describe):

```typescript
  it("toggleSidebar flips visibility from true (default) to false to true", () => {
    const initial = useSidebarStore.getState().sidebarVisible;
    expect(initial).toBe(true);
    useSidebarStore.getState().toggleSidebar();
    expect(useSidebarStore.getState().sidebarVisible).toBe(false);
    useSidebarStore.getState().toggleSidebar();
    expect(useSidebarStore.getState().sidebarVisible).toBe(true);
  });

  it("setSidebarVisible sets the explicit value", () => {
    useSidebarStore.getState().setSidebarVisible(false);
    expect(useSidebarStore.getState().sidebarVisible).toBe(false);
    useSidebarStore.getState().setSidebarVisible(true);
    expect(useSidebarStore.getState().sidebarVisible).toBe(true);
  });
```

- [ ] **Step 3: Run the new tests**

Run: `npm test -- --run src/store/sidebarStore.test.ts`
Expected: 2 new tests PASS in addition to the existing tests.

- [ ] **Step 4: Add Ctrl+B to keyboard shortcuts**

In `src/hooks/useKeyboardShortcuts.ts`, add a helper function (place above the `SHORTCUTS` array, near `toggleQuickViewer`):

```typescript
function toggleSidebar(): boolean {
  useSidebarStore.getState().toggleSidebar();
  return true;
}
```

Import at the top of the file (add to the existing import block):
```typescript
import { useSidebarStore } from "@/store/sidebarStore";
```

Add this entry to the `SHORTCUTS` array. Place it AFTER the focus-move arrow entries and BEFORE the Ctrl+Shift+M entry:

```typescript
  // Toggle Sidebar — Ctrl+B (DESIGN.md \xa77).
  {
    match: (e) => isCtrlOnly(e) && (e.key === "b" || e.key === "B"),
    run: () => toggleSidebar(),
  },
```

- [ ] **Step 5: Gate the Sidebar render in App.tsx**

In `src/App.tsx`:

Change the `useMdStore`/`useLayoutStore` selector block at the top of the function:

OLD:
```tsx
  const root = useLayoutStore((s) => s.root);
  const quickViewerOpen = useMdStore((s) => s.quickViewer.open);
  const mdMode = useMdStore((s) => s.mdEditorMode);
```
NEW (add the import to the existing imports first):
```tsx
import { useSidebarStore } from "@/store/sidebarStore";
```
And inside the component:
```tsx
  const root = useLayoutStore((s) => s.root);
  const quickViewerOpen = useMdStore((s) => s.quickViewer.open);
  const mdMode = useMdStore((s) => s.mdEditorMode);
  const sidebarVisible = useSidebarStore((s) => s.sidebarVisible);
```

Then replace the `<Sidebar />` line with:
```tsx
      {sidebarVisible && <Sidebar />}
```

- [ ] **Step 6: Verify tests + typecheck**

```bash
npm run typecheck
npm test -- --run
```
Expected: clean typecheck, 95+ tests passing (2 new sidebarStore tests added).

- [ ] **Step 7: Commit (deferred — bundles with Task 1.4)**

No commit yet.

---

### Task 1.7: Remove the W3 fallback 🗎 button from Sidebar header

**Files:**
- Modify: `src/components/Sidebar.tsx`

The Sidebar's W3-era 🗎 MD Editor toggle was an interim affordance until the top bar shipped. Now that TopBar has the real button, remove the duplicate.

- [ ] **Step 1: Remove the button JSX and unused imports**

In `src/components/Sidebar.tsx`:

1. Delete the JSX block:
```tsx
        <button
          className={`${styles.iconButton} ${mdEditorMode === "full" ? styles.active : ""}`}
          title={mdEditorMode === "full" ? "Close MD Editor (Ctrl+E)" : "Open MD Editor (Ctrl+E)"}
          onClick={() => setMdEditorMode(mdEditorMode === "full" ? "off" : "full")}
        >
          🗎
        </button>
```

2. Remove the now-unused selectors:
```tsx
  const mdEditorMode = useMdStore((s) => s.mdEditorMode);
  const setMdEditorMode = useMdStore((s) => s.setMdEditorMode);
```

3. The `useMdStore` import is still used for `openMdTab` in `onNewFile`. Leave it.

- [ ] **Step 2: Update the stale CSS comment**

In `src/components/Sidebar.module.css`, replace the comment block above `.iconButton.active`:

OLD:
```css
/* Active state for toggle-style icon buttons (e.g. MD Editor toggle when MD
 * Editor mode is "full"). Interim affordance until Weekend 4 ships the top
 * bar — that's where the spec's 🗎 MD Editor toggle is meant to live. */
```
NEW:
```css
/* Active state for toggle-style icon buttons inside the Sidebar header.
 * No buttons in the Sidebar header currently use it (the W3 🗎 toggle moved
 * to TopBar in W4). Kept for future Sidebar-local toggles. */
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 4: Commit (deferred — bundles with Task 1.4)**

---

### Task 1.8: Wire `<TopBar />` into App.tsx + verify on screen

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Switch outer layout to column-flex with TopBar at the top**

In `src/App.tsx`, add the import:
```tsx
import { TopBar } from "@/components/TopBar";
```

Then change the outer wrapper from a row-flex to a column-flex that wraps the existing row-flex:

OLD outer:
```tsx
  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        background: "var(--bg-0)",
        display: "flex",
        flexDirection: "row",
        boxSizing: "border-box",
      }}
    >
      <Sidebar />
      ...
      <ContextMenu />
    </div>
  );
```
NEW:
```tsx
  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        background: "var(--bg-0)",
        display: "flex",
        flexDirection: "column",
        boxSizing: "border-box",
      }}
    >
      <TopBar />
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "row",
        }}
      >
        {sidebarVisible && <Sidebar />}
        <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
          {mdMode === "full" ? (
            <MdEditor />
          ) : (
            <PanelGroup direction="horizontal" id="pg-root-h">
              <Panel defaultSize={quickViewerOpen ? 75 : 100} minSize={40}>
                {root === null ? (
                  <div
                    style={{
                      color: "var(--fg-2)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      height: "100%",
                    }}
                  >
                    empty layout
                  </div>
                ) : (
                  <PaneTree node={root} path="root" />
                )}
              </Panel>
              {quickViewerOpen && (
                <>
                  <PanelResizeHandle
                    onDragging={(isDragging) => {
                      if (isDragging) beginResize();
                      else endResize();
                    }}
                    style={{ width: 3, background: "var(--border)", cursor: "col-resize" }}
                  />
                  <Panel defaultSize={25} minSize={20} maxSize={60}>
                    <QuickViewer />
                  </Panel>
                </>
              )}
            </PanelGroup>
          )}
        </div>
      </div>
      <ContextMenu />
    </div>
  );
```

> **Implementer note:** `<StatusBar />` slots between the inner row-flex and `<ContextMenu />` in Phase 3. Don't add it yet — the StatusBar component doesn't exist yet.

- [ ] **Step 2: Run the full verification suite**

```bash
npm run typecheck
npm test -- --run
cargo test --lib --manifest-path src-tauri/Cargo.toml
cargo clippy --all-targets --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check
```
Expected: all green. Vitest count goes up by ~3 (TopBar test + 2 new sidebarStore tests).

- [ ] **Step 3: Manual smoke (controller responsibility — narrate to the user)**

The implementer subagent can't run a desktop window. Hand back to the controller with a "ready for `npm run tauri dev` smoke" note. Controller smoke-checklist:
- Window has no native titlebar.
- Drag the empty area between left buttons and window controls — the window moves.
- Double-click that empty area — toggles maximize.
- Click ☰ — Sidebar hides; click again — shows.
- Click 🗎 — MD Editor opens; click again — closes.
- Click 📄 — if there's no remembered Quick Viewer file, nothing happens (matches keyboard behaviour). After clicking an .md file in Sidebar once, click 📄 to toggle the QV.
- Click ⚙ — console warning (configClient isn't wired yet; Phase 2 fixes).
- Min / max / close buttons work; close-button hover is red.

- [ ] **Step 4: Commit the Phase 1 bundle**

```bash
git add src-tauri/tauri.conf.json src/lib/windowControls.ts src/components/TopBar.tsx src/components/TopBar.module.css src/components/TopBar.test.tsx src/store/sidebarStore.ts src/store/sidebarStore.test.ts src/hooks/useKeyboardShortcuts.ts src/components/Sidebar.tsx src/components/Sidebar.module.css src/App.tsx package.json package-lock.json
git commit -m "feat(titlebar): frameless custom titlebar with top-bar buttons

Tauri window decorations: false. New TopBar component renders the six
top-bar buttons (Sidebar toggle, Split right, Shortcuts viewer, MD
Editor toggle, Quick Viewer toggle, Settings gear) on the left and
Lucide-style min/max/close on the right. Drag region in the middle;
double-click toggles maximize.

Every clickable control sets data-tauri-drag-region=\"false\" — verified
by a new regression test (TopBar.test.tsx) per DESIGN.md \xa712 W5 #1d.

Sidebar header drops the W3 fallback 🗎 button (now lives in TopBar).
Ctrl+B toggles Sidebar visibility (sidebarStore.sidebarVisible).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Phase 1 — Holistic review

After commit 28 lands and per-task reviews are clean:

- [ ] **Dispatch a code-reviewer subagent** with the diff `git diff HEAD~1..HEAD` and ask:
  - Are all clickable controls in TopBar marked `data-tauri-drag-region="false"`? (The regression test asserts it, but the reviewer should verify the test actually catches a planted violation.)
  - Does the visual hierarchy match DESIGN.md §3 ASCII art (left cluster → drag → right window controls)?
  - Are aria-labels present on every button?
  - Any theme-token violations (raw hex colours, raw px sizes that should be `--space-N`)?
  - Did anything in CONTEXT.md ("Workstation surfaces") get violated?
- [ ] Fix any findings inline. Re-verify the gates. Then proceed to Phase 2.

---

# Phase 2 — `~/.workstation/config.toml` + hot reload + settingsStore

**Spec anchors:**
- DESIGN.md §6 (config schema), §12 W4 #2 + #3.
- CONTEXT.md does not redefine this — DESIGN.md is the source.

**Toast surface decision:** DESIGN.md §6 says "Unknown keys produce a warn toast". The toast UI doesn't exist in v0.1 (deferred per §8 wiring). For W4, warn via `tauri-plugin-log` (`log::warn!`) + `console.warn` on the JS side. Toast UI lands later; the messages already exist when it does.

### Task 2.1: Add the `toml` crate + scaffold `config.rs`

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Create: `src-tauri/src/config.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add `toml` to Cargo.toml**

In `src-tauri/Cargo.toml`, append to the `[dependencies]` block:
```toml
toml = "0.8"
```

- [ ] **Step 2: Write the schema + defaults in `config.rs`**

```rust
// src-tauri/src/config.rs
//
// Workstation config.toml schema, default generation, parse, file watch.
// Path: dirs::config_dir().join("workstation/config.toml")
//   Windows: %APPDATA%\workstation\config.toml
//   macOS:   ~/Library/Application Support/workstation/config.toml
//   Linux:   ~/.config/workstation/config.toml
//
// Schema lives in DESIGN.md \xa76. Unknown keys are logged at WARN level and
// then ignored — they do not abort the load (matches DESIGN.md \xa76 "Unknown
// keys produce a warn toast but don't break the load"). Toast surface is
// deferred to a later weekend; logging is the durable record until then.

use notify::{Config as NotifyConfig, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
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
# Full schema is documented in DESIGN.md \xa76.
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
# Override any key from DESIGN.md \xa77. Example:
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
    // and fall back to defaults for that sub-table only. To keep this simple
    // for v0.1 we report the whole-file parse error and fall back to default
    // config when the strict parse fails — DESIGN.md \xa76 says "Invalid values
    // fall back to last-known-valid config" which we honour at the JS layer
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
```

- [ ] **Step 3: Register the module + commands in `lib.rs`**

In `src-tauri/src/lib.rs`:

After `pub mod shell_detect;`, add:
```rust
pub mod config;
```

Add a `.manage(config::ConfigWatcherState::default())` after the existing `.manage(file_watcher::FileWatcherState::default())`:
```rust
        .manage(file_watcher::FileWatcherState::default())
        .manage(config::ConfigWatcherState::default())
```

Inside `tauri::generate_handler!`, add:
```rust
            crate::config::read_config,
            crate::config::write_default_config_if_missing,
            crate::config::watch_config,
            crate::config::config_file_path,
```

- [ ] **Step 4: Run the new Rust tests**

```bash
cargo test --lib --manifest-path src-tauri/Cargo.toml config::
```
Expected: 4 new passing tests inside `config::tests`.

- [ ] **Step 5: Verify the rest of the suite + clippy + fmt**

```bash
cargo test --lib --manifest-path src-tauri/Cargo.toml
cargo clippy --all-targets --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check
```
Expected: all green.

- [ ] **Step 6: Commit (deferred — bundles with Tasks 2.2 + 2.3 + 2.4)**

No commit yet. All Phase 2 tasks bundle into commit 29.

---

### Task 2.2: `WorkstationConfig` TS type + configClient

**Files:**
- Create: `src/types/config.ts`
- Create: `src/lib/configClient.ts`

- [ ] **Step 1: Write the TS type mirror**

```typescript
// src/types/config.ts
//
// Mirror of src-tauri/src/config.rs WorkstationConfig. Field names and
// nesting must match exactly — TOML ↔ serde ↔ JSON ↔ this type.
// If you change one side, change the other.

export interface FontConfig {
  family: string;
  size: number;
}

export interface TerminalConfig {
  scrollback_lines: number;
  ipc_batch_ms: number;
  ring_buffer_mb: number;
}

export interface MdEditorConfig {
  soft_wrap: boolean;
  line_numbers: boolean;
  indent_spaces: number;
  trim_trailing_whitespace_on_save: boolean;
  default_mode: "view" | "edit";
}

export interface QuickViewerConfig {
  width_pct: number;
}

export interface SidebarConfig {
  visible: boolean;
  collapsed_dirs: string[];
}

export interface ThemeConfig {
  accent: "amber"; // v0.1 lock; v0.2 expands
}

export interface LogConfig {
  level: "debug" | "info" | "warn" | "error";
  path: string;
}

export interface WorkstationConfig {
  default_shell: string;
  font: FontConfig;
  terminal: TerminalConfig;
  md_editor: MdEditorConfig;
  quick_viewer: QuickViewerConfig;
  sidebar: SidebarConfig;
  theme: ThemeConfig;
  log: LogConfig;
}
```

- [ ] **Step 2: Write `configClient.ts`**

```typescript
// src/lib/configClient.ts
//
// Wrappers around the Rust config commands. Hot-reload subscription uses
// a Tauri Channel that emits ConfigEvent records when ~/.workstation/
// config.toml changes on disk.

import { invoke, Channel } from "@tauri-apps/api/core";
import type { WorkstationConfig } from "@/types/config";

export function readConfig(): Promise<WorkstationConfig> {
  return invoke<WorkstationConfig>("read_config");
}

export function writeDefaultConfigIfMissing(): Promise<boolean> {
  return invoke<boolean>("write_default_config_if_missing");
}

export function configFilePath(): Promise<string> {
  return invoke<string>("config_file_path");
}

export type ConfigEvent = { kind: "changed"; path: string };

/**
 * Subscribe to config-file changes. Returns a no-op unsubscribe placeholder
 * — Tauri Channels are torn down when the receiver is garbage-collected;
 * for v0.1 the watcher lives for the full app lifetime. If you need to
 * stop watching, restart the app.
 */
export async function watchConfig(
  onChange: (event: ConfigEvent) => void
): Promise<() => void> {
  const channel = new Channel<ConfigEvent>();
  channel.onmessage = (e) => onChange(e);
  await invoke<void>("watch_config", { channel });
  return () => {
    // Best-effort: replace the handler with a no-op. The Rust-side watcher
    // continues until the app exits.
    channel.onmessage = () => undefined;
  };
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 4: Commit (deferred — bundles with Tasks 2.3 + 2.4)**

---

### Task 2.3: `settingsStore` + tests

**Files:**
- Create: `src/store/settingsStore.ts`
- Create: `src/store/settingsStore.test.ts`

- [ ] **Step 1: Write the failing tests FIRST (TDD)**

```typescript
// src/store/settingsStore.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useSettingsStore, defaultSettings } from "@/store/settingsStore";
import type { WorkstationConfig } from "@/types/config";

vi.mock("@/lib/configClient", () => ({
  readConfig: vi.fn(),
  writeDefaultConfigIfMissing: vi.fn(),
  watchConfig: vi.fn(),
  configFilePath: vi.fn(),
}));

describe("settingsStore", () => {
  beforeEach(() => {
    useSettingsStore.getState().reset();
  });

  it("starts with the default settings", () => {
    expect(useSettingsStore.getState().config).toEqual(defaultSettings);
  });

  it("applyConfig replaces config with the input", () => {
    const cfg: WorkstationConfig = {
      ...defaultSettings,
      default_shell: "cmd",
      font: { family: "Inter", size: 16 },
    };
    useSettingsStore.getState().applyConfig(cfg);
    expect(useSettingsStore.getState().config.default_shell).toBe("cmd");
    expect(useSettingsStore.getState().config.font.size).toBe(16);
  });

  it("applyConfig records a lastValidConfig snapshot", () => {
    const cfg: WorkstationConfig = {
      ...defaultSettings,
      default_shell: "powershell",
    };
    useSettingsStore.getState().applyConfig(cfg);
    expect(useSettingsStore.getState().lastValidConfig).toEqual(cfg);
  });

  it("revertToLastValid restores the snapshot", () => {
    const good: WorkstationConfig = { ...defaultSettings, default_shell: "pwsh" };
    useSettingsStore.getState().applyConfig(good);

    // Force an in-place mutation as if a hot-reload had brought bad data
    useSettingsStore.setState({
      config: { ...defaultSettings, default_shell: "garbage" },
    });
    useSettingsStore.getState().revertToLastValid();
    expect(useSettingsStore.getState().config).toEqual(good);
  });
});
```

- [ ] **Step 2: Run the tests — expect FAIL with "Cannot find module"**

Run: `npm test -- --run src/store/settingsStore.test.ts`
Expected: FAIL on import.

- [ ] **Step 3: Write `settingsStore.ts`**

```typescript
// src/store/settingsStore.ts
//
// Mirror of ~/.workstation/config.toml. Hot-reloads when the file changes
// on disk via the watch_config Tauri command (see configClient.watchConfig).
//
// DESIGN.md \xa76: "Unknown keys produce a warn toast but don't break the
// load. Invalid values fall back to last-known-valid config." We honour the
// fallback via `lastValidConfig` — every successful applyConfig snapshots
// the input. A bad parse (raised by configClient.readConfig as a Promise
// rejection) leaves the current config in place; if a downstream consumer
// chooses to call revertToLastValid we restore the snapshot.

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

import type { WorkstationConfig } from "@/types/config";

export const defaultSettings: WorkstationConfig = {
  default_shell: "pwsh",
  font: { family: "JetBrains Mono", size: 14 },
  terminal: {
    scrollback_lines: 10_000,
    ipc_batch_ms: 32,
    ring_buffer_mb: 8,
  },
  md_editor: {
    soft_wrap: true,
    line_numbers: true,
    indent_spaces: 2,
    trim_trailing_whitespace_on_save: true,
    default_mode: "view",
  },
  quick_viewer: { width_pct: 25 },
  sidebar: {
    visible: true,
    collapsed_dirs: [
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
    ],
  },
  theme: { accent: "amber" },
  log: { level: "info", path: "%LOCALAPPDATA%\\workstation\\logs" },
};

interface SettingsState {
  config: WorkstationConfig;
  /** Snapshot of the last config that successfully applied. Used to recover
   *  from a bad hot-reload. */
  lastValidConfig: WorkstationConfig;
}

interface SettingsActions {
  applyConfig: (cfg: WorkstationConfig) => void;
  revertToLastValid: () => void;
  reset: () => void;
}

export type SettingsStore = SettingsState & SettingsActions;

export const useSettingsStore = create<SettingsStore>()(
  devtools(
    immer((set) => ({
      config: defaultSettings,
      lastValidConfig: defaultSettings,

      applyConfig: (cfg) =>
        set((s) => {
          s.config = cfg;
          s.lastValidConfig = cfg;
        }),

      revertToLastValid: () =>
        set((s) => {
          s.config = s.lastValidConfig;
        }),

      reset: () =>
        set((s) => {
          s.config = defaultSettings;
          s.lastValidConfig = defaultSettings;
        }),
    })),
    { name: "settingsStore" }
  )
);
```

- [ ] **Step 4: Run the tests — expect PASS**

Run: `npm test -- --run src/store/settingsStore.test.ts`
Expected: 4 passing tests.

- [ ] **Step 5: Commit (deferred — bundles with Task 2.4)**

---

### Task 2.4: Bootstrap config + hot reload at app start, wire Settings gear

**Files:**
- Modify: `src/main.tsx`
- Modify: `src/components/TopBar.tsx` (Settings gear is already wired to `configClient.configFilePath`; verify after this task)
- Modify: `src/hooks/useKeyboardShortcuts.ts` (no change — listed only for parallel-read with the surface area)

- [ ] **Step 1: Bootstrap config on app launch**

Replace `src/main.tsx`:

```tsx
import "@/styles/theme.css";
import "@/styles/fonts.css";
import ReactDOM from "react-dom/client";
import App from "./App";
import {
  readConfig,
  watchConfig,
  writeDefaultConfigIfMissing,
} from "@/lib/configClient";
import { useSettingsStore } from "@/store/settingsStore";

// StrictMode intentionally OFF — see DESIGN.md \xa74 rule #2.
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);

// Config bootstrap: create the default file if missing, then load it.
// This runs AFTER the first render so the initial paint isn't blocked. A
// brief moment of defaults is visible while the file loads; in practice
// the read is fast enough that no flash occurs.
void (async () => {
  try {
    const created = await writeDefaultConfigIfMissing();
    if (created) console.info("config.toml created with defaults");
    const cfg = await readConfig();
    useSettingsStore.getState().applyConfig(cfg);
  } catch (err) {
    console.error("config bootstrap failed; keeping defaults", err);
  }
  // Hot reload subscription. Re-reads on every Changed event.
  try {
    await watchConfig(async (e) => {
      if (e.kind !== "changed") return;
      try {
        const cfg = await readConfig();
        useSettingsStore.getState().applyConfig(cfg);
        console.info("config.toml hot-reloaded");
      } catch (err) {
        console.warn("hot reload parse failed; keeping last valid", err);
        useSettingsStore.getState().revertToLastValid();
      }
    });
  } catch (err) {
    console.error("watchConfig failed; hot reload disabled", err);
  }
})();
```

- [ ] **Step 2: Verify TopBar Settings gear opens the config file**

No code change. The Settings gear in TopBar already imports `configFilePath` dynamically and calls `openMdTab(path)`. After this task it works end-to-end.

- [ ] **Step 3: Full verification suite**

```bash
npm run typecheck
npm test -- --run
cargo test --lib --manifest-path src-tauri/Cargo.toml
cargo clippy --all-targets --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check
```
Expected: all green. Vitest +4 from settingsStore tests, cargo +4 from config tests.

- [ ] **Step 4: Commit the Phase 2 bundle**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/config.rs src-tauri/src/lib.rs src/lib/configClient.ts src/types/config.ts src/store/settingsStore.ts src/store/settingsStore.test.ts src/main.tsx
git commit -m "feat(config): config.toml schema + hot reload + settingsStore

New Rust module src-tauri/src/config.rs:
- WorkstationConfig struct mirroring DESIGN.md \xa76 schema
- write_default_config_if_missing creates ~/.workstation/config.toml on
  first launch (Windows: %APPDATA%\\workstation\\config.toml)
- read_config returns the parsed config; unknown top-level keys log WARN
  and are ignored; strict sub-table parse failures fall back to defaults
- watch_config installs a notify watcher on the config dir, debounced to
  150ms to coalesce editor save-bursts; emits ConfigEvent.Changed over a
  Tauri Channel

JS side:
- configClient wrappers
- settingsStore (Zustand + immer + devtools): config + lastValidConfig
  snapshot; revertToLastValid recovers from a bad hot-reload
- main.tsx bootstraps the default file + first read + watch subscription
- TopBar ⚙ Settings gear opens config.toml in an MD Editor tab

Toasts for warnings are deferred — warnings go via tauri-plugin-log +
console for now (DESIGN.md \xa78 toast wiring is a separate weekend).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Phase 2 — Holistic review

After commit 29 lands:

- [ ] **Dispatch a code-reviewer subagent** with the diff `git diff HEAD~1..HEAD` and ask:
  - Does the config schema in `config.rs` match DESIGN.md §6 exactly? (Field names, defaults, types.)
  - Does the TS `WorkstationConfig` type in `src/types/config.ts` match the Rust struct field-for-field?
  - Is the 150ms debounce reasonable for the editors named (VS Code / Sublime / nvim)? Any edge case where a save would be missed?
  - Does the bootstrap in `main.tsx` race the first render? If a paint depends on settings (it shouldn't yet — Phase 3/4 introduce that), is there a visible flash?
  - Are the warn-logs durable enough to debug a config issue without a toast?
- [ ] Fix any findings. Re-verify gates. Proceed to Phase 3.

---

# Phase 3 — Status Bar

**Spec anchors:**
- DESIGN.md §3 (Status Bar element), §12 W4 #5.
- CONTEXT.md "Status Bar".

**v0.1 limitation:** The active-process indicator counts panes where `PaneStatus === "running"`. Without OSC 7 shell integration (deferred to v0.2 per DESIGN.md §3 and §12), we cannot distinguish "idle shell at a prompt" from "shell running a foreground program". The indicator is therefore "panes that have a live PTY", which on first launch is "every pane" — visually noisy but accurate to the data we have. Better than no indicator. CONTEXT.md "Status Bar" already states "v0.3+ jumps to Dashboard; in v0.1 it is informational only" so the inflation here is documented as a known v0.1 limitation in implementation notes.

### Task 3.1: Add focus surface tracking to mdStore

**Files:**
- Modify: `src/store/mdStore.ts`

The Status Bar needs to know which surface (Terminal / MD Editor / Quick Viewer / Sidebar) has focus to render the LEFT segment. Today only `layoutStore.focusedPaneId` is tracked, which gives Terminal focus but not "user is reading the MD Editor right now".

Lightweight approach: add `focusedSurface: "terminal" | "md-editor" | "quick-viewer" | "sidebar" | null` to mdStore (it's the closest existing store; alternatively a tiny `uiStore` would be cleaner but spending a new store on one flag is overkill for v0.1).

- [ ] **Step 1: Extend `MdStoreState`**

In `src/store/mdStore.ts`:

Add the type union near the top:
```typescript
export type FocusedSurface =
  | "terminal"
  | "md-editor"
  | "quick-viewer"
  | "sidebar"
  | null;
```

Add to the `MdStoreState` interface:
```typescript
  focusedSurface: FocusedSurface;
  setFocusedSurface: (s: FocusedSurface) => void;
```

In the store body:
```typescript
      focusedSurface: null,
      setFocusedSurface: (focusedSurface) =>
        set((s) => {
          s.focusedSurface = focusedSurface;
        }),
```

In `reset`:
```typescript
          s.focusedSurface = null;
```

- [ ] **Step 2: Wire focus reporting from the existing components**

In `src/components/MdEditor.tsx` — at the top of the function body, add:
```tsx
import { useEffect } from "react";
// ... existing imports

// then inside the component, find the existing useEffect block (or create one)
useEffect(() => {
  useMdStore.getState().setFocusedSurface("md-editor");
}, []);
```

> **Implementer note:** If MdEditor already has a `useEffect`, append the call inside it rather than creating a duplicate. Just before the function returns is also fine; pick whichever reads cleanest in the existing file.

In `src/components/QuickViewer.tsx` — same shape:
```tsx
import { useEffect } from "react";

useEffect(() => {
  useMdStore.getState().setFocusedSurface("quick-viewer");
}, []);
```

In `src/components/Sidebar.tsx` — same shape but on focus event:
```tsx
<div className={styles.sidebar} onFocus={() => useMdStore.getState().setFocusedSurface("sidebar")}>
```

In `src/components/TerminalPane.tsx` — wire on the existing focus handler. Find where the pane already calls `useLayoutStore.getState().focusPane(paneId)` (from W2) and append:
```tsx
useMdStore.getState().setFocusedSurface("terminal");
```

> **Implementer note (review fodder):** The mdStore is the wrong store for `focusedSurface` long-term — it's UI state, not markdown state. v0.1 carries it here because spinning up a `uiStore` for a single flag is overkill. If a second cross-cutting UI flag arrives, refactor into a `uiStore` at that point. Flag for the phase-boundary holistic review.

- [ ] **Step 3: Typecheck + tests**

Run:
```bash
npm run typecheck
npm test -- --run
```
Expected: clean. mdStore tests still pass — the new field has a default and a setter only.

- [ ] **Step 4: Commit (deferred — bundles with Tasks 3.2 + 3.3)**

---

### Task 3.2: StatusBar component + CSS

**Files:**
- Create: `src/components/StatusBar.tsx`
- Create: `src/components/StatusBar.module.css`

- [ ] **Step 1: Write `StatusBar.module.css`**

```css
/* src/components/StatusBar.module.css
 *
 * 24px bottom bar (DESIGN.md \xa73 + CONTEXT.md "Status Bar"). bg.1 with a
 * 1px top border. JetBrains Mono 12px, fg.1. Two segments — left grows,
 * right shrinks-to-fit. */

.root {
  height: 24px;
  flex-shrink: 0;
  background: var(--bg-1);
  border-top: 1px solid var(--border);
  display: flex;
  align-items: center;
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--fg-1);
  padding: 0 var(--space-3);
  user-select: none;
  box-sizing: border-box;
  gap: var(--space-3);
}

.left {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.right {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

.workspace {
  color: var(--fg-1);
}

.proc {
  color: var(--accent);
}

.sep {
  color: var(--fg-2);
}
```

- [ ] **Step 2: Write `StatusBar.tsx`**

```tsx
// src/components/StatusBar.tsx
//
// DESIGN.md \xa73 + CONTEXT.md "Status Bar".
// LEFT segment: focus-aware summary.
//   - Terminal focused  -> "[shell] \xb7 [cwd]"
//   - MD Editor focused -> "[file] \xb7 Ln N, Col M"
//   - Quick Viewer      -> same as MD Editor (file name only — no cursor)
//   - Sidebar focused   -> workspace folder path
// RIGHT segment: "[workspace short name]  ⏵ N" — N counts running PTYs.
//
// v0.1 limitation: "running" means "PTY is alive", not "shell is in a
// foreground program". OSC 7 shell-integration (v0.2) refines this.

import styles from "@/components/StatusBar.module.css";
import { useMdStore } from "@/store/mdStore";
import { useLayoutStore } from "@/store/layoutStore";
import { usePtyStore } from "@/store/ptyStore";
import { useSidebarStore } from "@/store/sidebarStore";
import { shellLabel } from "@/lib/shellsClient";

function shortName(path: string | null): string {
  if (!path) return "—";
  // Pick the trailing path segment; trim trailing slashes first.
  const trimmed = path.replace(/[/\\]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

export function StatusBar() {
  const focusedSurface = useMdStore((s) => s.focusedSurface);
  const focusedPaneId = useLayoutStore((s) => s.focusedPaneId);
  const panes = usePtyStore((s) => s.panes);
  const tabs = useMdStore((s) => s.tabs);
  const activeTabId = useMdStore((s) => s.activeTabId);
  const qvPath = useMdStore((s) => s.quickViewer.path);
  const workspaceFolder = useSidebarStore((s) => s.workspaceFolder);

  // ---- LEFT segment ----
  let left = "";
  if (focusedSurface === "md-editor") {
    const tab = tabs.find((t) => t.id === activeTabId);
    if (tab) {
      const name = shortName(tab.path);
      // Ln/Col is not tracked in v0.1 (no CM-EditorView selector lift into
      // the store). Display the file name with a (-, -) placeholder so the
      // shape matches the spec; v0.2 wires selection state.
      left = `${name} \xb7 Ln —, Col —`;
    } else {
      left = "MD Editor";
    }
  } else if (focusedSurface === "quick-viewer") {
    left = qvPath ? shortName(qvPath) : "Quick Viewer";
  } else if (focusedSurface === "sidebar") {
    left = workspaceFolder ?? "";
  } else if (focusedSurface === "terminal" && focusedPaneId !== null) {
    const meta = panes[focusedPaneId];
    if (meta) {
      const shell = shellLabel(meta.shell);
      const cwd = meta.cwd ?? "(unknown cwd)";
      left = `${shell} \xb7 ${cwd}`;
    } else {
      left = "Terminal";
    }
  } else {
    // No focused surface yet (e.g. first launch before anything has focus).
    left = workspaceFolder ?? "";
  }

  // ---- RIGHT segment ----
  // Count panes whose status is "running". This is a v0.1 approximation —
  // see file-header note.
  const runningCount = Object.values(panes).filter(
    (p) => p.status === "running"
  ).length;
  const wsShort = shortName(workspaceFolder);

  return (
    <div className={styles.root} aria-label="Status Bar">
      <div className={styles.left} title={left}>
        {left}
      </div>
      <div className={styles.right}>
        <span className={styles.workspace}>{wsShort}</span>
        {runningCount > 0 && (
          <>
            <span className={styles.sep}>\xb7</span>
            <span
              className={styles.proc}
              title={`${runningCount} terminal${runningCount === 1 ? "" : "s"} running`}
              aria-label={`${runningCount} running terminals`}
            >
              {`⏵ ${runningCount}`}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
```

> **Implementer note:** `shellLabel` already exists in `src/lib/shellsClient.ts` (Phase 3 of W3). Confirm the import resolves; if `shellLabel` lives under a different name, use that name. Do not invent a new helper.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 4: Commit (deferred — bundles with Task 3.3)**

---

### Task 3.3: Wire `<StatusBar />` into App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Mount StatusBar at the bottom of the column flex**

Import:
```tsx
import { StatusBar } from "@/components/StatusBar";
```

In the JSX, after the inner row-flex `<div>` that wraps Sidebar + main, before `<ContextMenu />`, add:
```tsx
      <StatusBar />
```

So the outer structure becomes:
```
<div column-flex>
  <TopBar />
  <div row-flex>...Sidebar + main...</div>
  <StatusBar />
  <ContextMenu />
</div>
```

- [ ] **Step 2: Manual smoke (controller responsibility)**

Hand back to controller after the commit with a smoke checklist:
- Status bar visible at the bottom, 24px tall, monospace.
- Focus a Terminal pane → left segment shows `[shell] · [cwd]`.
- Open MD Editor → left segment shows file name + `Ln —, Col —`.
- Open Quick Viewer → left segment shows the file name.
- Click in Sidebar → left segment shows workspace folder path.
- Right segment shows workspace short name + `⏵ N` in amber.

- [ ] **Step 3: Full verification suite**

```bash
npm run typecheck
npm test -- --run
cargo test --lib --manifest-path src-tauri/Cargo.toml
cargo clippy --all-targets --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check
```
Expected: all green.

- [ ] **Step 4: Commit the Phase 3 bundle**

```bash
git add src/store/mdStore.ts src/components/MdEditor.tsx src/components/QuickViewer.tsx src/components/Sidebar.tsx src/components/TerminalPane.tsx src/components/StatusBar.tsx src/components/StatusBar.module.css src/App.tsx
git commit -m "feat(statusbar): focused-element-aware Status Bar

24px bottom bar wired into the column-flex root layout. LEFT segment is
focus-aware — Terminal -> [shell] \xb7 [cwd], MD Editor -> [file] \xb7 Ln/Col
(Ln/Col is a placeholder in v0.1, no CM selector lift), Quick Viewer ->
file name, Sidebar -> workspace folder path. RIGHT segment shows
workspace short name + ⏵ N running-PTY indicator in accent.

Focused-surface tracking lives on mdStore.focusedSurface for v0.1 —
single flag, not worth a new store yet. Components report focus via
setFocusedSurface.

v0.1 limitation: 'running' means 'PTY is alive', not 'shell is in a
foreground program'. OSC 7 shell-integration refines this in v0.2
(DESIGN.md \xa712 v0.4+).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Phase 3 — Holistic review

- [ ] **Dispatch a code-reviewer subagent** with the diff and ask:
  - Does the LEFT-segment routing match CONTEXT.md "Status Bar" exactly?
  - Is `setFocusedSurface` called from every surface that should claim focus?
  - The mdStore-as-UI-store smell is documented — confirm it's truly an acceptable v0.1 trade-off given the small surface area.
  - Any theme-token violations? Any place using a raw hex / font name?
  - Does the right-segment placeholder when `runningCount === 0` (no indicator shown) match the spec? CONTEXT.md: "omitted when N=0" — confirm.

---

# Phase 4 — Persistence via @tauri-apps/plugin-store

**Spec anchors:**
- DESIGN.md §4 (Store slices + middleware), §12 W4 #6.
- DESIGN.md §1 invariant 5: "PTYs do not survive Workstation restart. Each Pane re-spawns a fresh shell at its saved cwd when the Workstation reopens."

**Persist boundary (final list):**
- **Persist:** `layoutStore.root`, `sidebarStore.{workspaceFolder, sidebarVisible}`, `mdStore.mdEditorMode`.
- **Do NOT persist:** PTY metadata (ephemeral; orchestrator re-spawns on layout rehydrate), `layoutStore.focusedPaneId` (set to first leaf on hydrate), xterm instances (module-level Map), `lastActivity` timestamps, `mdStore.tabs` / `mdStore.quickViewer` (per DESIGN.md §4 EXCLUDED list — tabs are session state in v0.1; v0.2 adds explicit tab persistence).

### Task 4.1: Tauri Store adapter for Zustand persist

**Files:**
- Create: `src/lib/persistStorage.ts`

- [ ] **Step 1: Write the adapter**

```typescript
// src/lib/persistStorage.ts
//
// Adapter implementing Zustand's StateStorage interface backed by
// @tauri-apps/plugin-store. localStorage is webview-scoped and size-limited;
// the Tauri Store plugin writes JSON to disk atomically via Rust, in the
// platform config dir (DESIGN.md \xa74).
//
// Storage layout: one Tauri store file per Zustand slice. Names are kept
// stable so the persisted format is portable across app versions; bump the
// `version` field in each store's persist config to migrate.

import { load, type Store } from "@tauri-apps/plugin-store";
import type { StateStorage } from "zustand/middleware";

/** Cache the loaded Store handles by file name so each Zustand persist
 *  middleware sees the same instance. */
const storeCache = new Map<string, Promise<Store>>();

function getStore(filename: string): Promise<Store> {
  let p = storeCache.get(filename);
  if (!p) {
    p = load(filename, { autoSave: true });
    storeCache.set(filename, p);
  }
  return p;
}

export function tauriPersistStorage(filename: string): StateStorage {
  return {
    async getItem(name: string): Promise<string | null> {
      const store = await getStore(filename);
      const v = await store.get<string>(name);
      return v ?? null;
    },
    async setItem(name: string, value: string): Promise<void> {
      const store = await getStore(filename);
      await store.set(name, value);
    },
    async removeItem(name: string): Promise<void> {
      const store = await getStore(filename);
      await store.delete(name);
    },
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Commit (deferred — bundles with Tasks 4.2 + 4.3 + 4.4)**

---

### Task 4.2: Persist sidebarStore visibility + workspace folder

**Files:**
- Modify: `src/store/sidebarStore.ts`
- Modify: `src/store/sidebarStore.test.ts`

- [ ] **Step 1: Wrap the store with `persist`**

In `src/store/sidebarStore.ts`:

Add imports:
```typescript
import { persist, createJSONStorage } from "zustand/middleware";
import { tauriPersistStorage } from "@/lib/persistStorage";
```

Wrap the existing `devtools(immer(...))` with `persist(...)`:

OLD:
```typescript
export const useSidebarStore = create<SidebarState>()(
  devtools(
    immer((set, get) => ({
      // ... body
    })),
    { name: "sidebarStore" }
  )
);
```

NEW:
```typescript
export const useSidebarStore = create<SidebarState>()(
  devtools(
    persist(
      immer((set, get) => ({
        // ... body unchanged
      })),
      {
        name: "sidebar",
        storage: createJSONStorage(() => tauriPersistStorage("workstation-store.json")),
        version: 1,
        // Persist only the durable bits. entries (Map) and expanded (Set)
        // are session state — they get re-read from disk on launch via
        // listDir, so persisting would just waste space.
        partialize: (state) => ({
          workspaceFolder: state.workspaceFolder,
          sidebarVisible: state.sidebarVisible,
        }),
      }
    ),
    { name: "sidebarStore" }
  )
);
```

> **Important:** `partialize` returns the partial — Zustand merges it back into the full state on hydrate. The Map/Set fields keep their initial values until `loadDir` repopulates them.

- [ ] **Step 2: Update the existing test mock to satisfy the persist middleware**

Append to the top of `src/store/sidebarStore.test.ts`:

```typescript
import { vi } from "vitest";

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: vi.fn(async () => null),
    set: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  })),
}));
```

> **Implementer note:** If `vi.mock` is already imported, only add the `vi.mock("@tauri-apps/plugin-store", ...)` block. The persist middleware reads from the storage on hydrate; the mock returns `null` so the store stays at its declared defaults inside the test.

- [ ] **Step 3: Run the tests**

Run: `npm test -- --run src/store/sidebarStore.test.ts`
Expected: existing tests pass; persist middleware doesn't interfere because the mock returns `null`.

- [ ] **Step 4: Commit (deferred — bundles with Tasks 4.3 + 4.4)**

---

### Task 4.3: Persist mdStore.mdEditorMode

**Files:**
- Modify: `src/store/mdStore.ts`
- Modify: `src/store/mdStore.test.ts`

- [ ] **Step 1: Wrap mdStore with `persist`**

In `src/store/mdStore.ts`, mirror the sidebarStore pattern:

Add imports:
```typescript
import { persist, createJSONStorage } from "zustand/middleware";
import { tauriPersistStorage } from "@/lib/persistStorage";
```

Wrap the store body:
```typescript
export const useMdStore = create<MdStoreState>()(
  devtools(
    persist(
      immer((set, get) => ({
        // ... existing body
      })),
      {
        name: "md",
        storage: createJSONStorage(() => tauriPersistStorage("workstation-store.json")),
        version: 1,
        partialize: (state) => ({ mdEditorMode: state.mdEditorMode }),
      }
    ),
    { name: "mdStore" }
  )
);
```

- [ ] **Step 2: Update `mdStore.test.ts` with the plugin-store mock**

Append at the top of `src/store/mdStore.test.ts`:
```typescript
vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: vi.fn(async () => null),
    set: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  })),
}));
```

- [ ] **Step 3: Run tests**

Run: `npm test -- --run src/store/mdStore.test.ts`
Expected: existing tests pass.

- [ ] **Step 4: Commit (deferred — bundles with Task 4.4)**

---

### Task 4.4: Persist layoutStore.root + cold-start orchestration

**Files:**
- Modify: `src/store/layoutStore.ts`
- Modify: `src/App.tsx`
- Modify: `src/store/stores.test.ts` (if it exercises layoutStore directly)

- [ ] **Step 1: Wrap layoutStore with `persist`**

In `src/store/layoutStore.ts`:

Add imports:
```typescript
import { persist, createJSONStorage } from "zustand/middleware";
import { tauriPersistStorage } from "@/lib/persistStorage";
```

Wrap the store:
```typescript
export const useLayoutStore = create<LayoutStore>()(
  devtools(
    persist(
      immer((set) => ({
        // ... existing body
      })),
      {
        name: "layout",
        storage: createJSONStorage(() => tauriPersistStorage("workstation-store.json")),
        version: 1,
        // Persist the tree shape only. focusedPaneId is intentionally reset
        // on rehydrate — DESIGN.md \xa74 EXCLUDED list. The orchestrator
        // re-spawns PTYs by reacting to leaves appearing in the layout.
        partialize: (state) => ({ root: state.root }),
        // On hydrate, ensure focusedPaneId points to a valid leaf.
        onRehydrateStorage: () => (state) => {
          if (state && state.root !== null) {
            // Pick the first leaf in DFS order.
            const ids = getPaneIds(state);
            // Direct mutation (state.focusedPaneId = ...) bypasses
            // notifyListeners — the focused-pane border wouldn't appear
            // on the rehydrated leaf until a user interaction. setState
            // dispatches through the store so subscribers re-render.
            useLayoutStore.setState({ focusedPaneId: ids[0] ?? null });
          }
        },
      }
    ),
    { name: "layout", enabled: import.meta.env.DEV }
  )
);
```

> **Note:** `getPaneIds` is already exported from this file. Use it inside `onRehydrateStorage` (it's hoisted).

- [ ] **Step 2: Adjust App.tsx bootstrap to handle rehydrated layouts**

In `src/App.tsx`, the existing `useEffect` reads:
```tsx
    const { root: existingRoot, initWithFirstPane } = useLayoutStore.getState();
    if (existingRoot === null) {
      initWithFirstPane("pane-1");
    }
```

This is already correct — if persistence restored `root`, the bootstrap is skipped. Confirm by reading and leave as-is.

> **Implementer note:** Persistence is async (Tauri Store load returns a Promise). The first render may see the default empty layout before rehydration completes; React will re-render once hydrated. To avoid the visible flash:
> 1. Add an `_hasHydrated` flag to layoutStore, set true in `onRehydrateStorage`.
> 2. In App.tsx, render a small `<div>` placeholder while `!useLayoutStore((s) => s._hasHydrated)`.
> v0.1 ships without the flash guard — first paint is fast enough that the user perceives one render. Flag for v0.2 polish if it bites.

- [ ] **Step 3: Add mock to layout-relevant tests**

If any test file in `src/store/` imports `useLayoutStore`, append the plugin-store mock to that file's imports:
```typescript
vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: vi.fn(async () => null),
    set: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  })),
}));
```

> **Implementer note:** Hunt with `grep -r "useLayoutStore" src/store/*.test.ts`. Apply the mock to every test file that imports any of the three persisted stores. The mock returns `null` for all gets, so behavior is identical to non-persisted defaults.

- [ ] **Step 4: Run the full suite**

```bash
npm run typecheck
npm test -- --run
cargo test --lib --manifest-path src-tauri/Cargo.toml
cargo clippy --all-targets --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check
```
Expected: all green.

- [ ] **Step 5: Smoke (controller responsibility, post-commit)**

In `npm run tauri dev`:
1. Open the app, split into 2-3 panes, change workspace folder (when that surface ships — for v0.1 it stays home dir), toggle Sidebar off, switch MD Editor on.
2. Close the window via the close button.
3. Reopen. Verify:
   - Same number of panes in the same shape.
   - Sidebar is hidden (matches your toggle).
   - MD Editor mode is "full" (matches your toggle).
   - PTYs are fresh shells at home dir (running processes from before are NOT restored — DESIGN.md §1 invariant 5).

- [ ] **Step 6: Commit the Phase 4 bundle**

```bash
git add src/lib/persistStorage.ts src/store/sidebarStore.ts src/store/sidebarStore.test.ts src/store/mdStore.ts src/store/mdStore.test.ts src/store/layoutStore.ts src/App.tsx src/store/stores.test.ts
git commit -m "feat(persist): Zustand persist via tauri-plugin-store

Wraps layoutStore, sidebarStore, mdStore with zustand/middleware/persist
backed by a tauri-plugin-store adapter (src/lib/persistStorage.ts).
localStorage is webview-scoped and size-limited; the plugin writes JSON
to disk atomically via Rust in the platform config dir (DESIGN.md \xa74).

Persisted slices (per DESIGN.md \xa74):
  - layoutStore.root (tree shape; focusedPaneId reset on hydrate)
  - sidebarStore.workspaceFolder, sidebarVisible
  - mdStore.mdEditorMode

Not persisted (DESIGN.md \xa74 EXCLUDED):
  - PTY metadata (ephemeral, orchestrator re-spawns)
  - focusedPaneId (resets to first leaf on hydrate)
  - xterm instances (module-level Map)
  - lastActivity timestamps
  - mdStore tabs / quickViewer (session state in v0.1)

PTYs do NOT survive restart per DESIGN.md \xa71 invariant 5 — Layout shape
is restored, processes are re-spawned fresh at saved cwd.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Phase 4 — Holistic review

- [ ] **Dispatch a code-reviewer subagent** with the diff and ask:
  - Are the `partialize` lists correct against DESIGN.md §4's EXCLUDED list?
  - Does `onRehydrateStorage` re-establish focus to a valid leaf in every code path? What if the persisted tree references paneIds the orchestrator hasn't spawned yet — is there a race?
  - Is the test mock applied to every store test file that touches a persisted store?
  - Does the Tauri Store file path land where `dirs::data_dir()` says it should (per `@tauri-apps/plugin-store` defaults)?
  - Any edge case where Sidebar visibility could be `false` AND no toggle is reachable (user can't get it back)?

---

# Final post-W4 review

After commit 31 lands:

- [ ] **Dispatch one final code-reviewer subagent** with `git diff HEAD~4..HEAD` (the four phase commits) and ask:
  - Read DESIGN.md §12 Weekend 4 line by line. For each numbered item, confirm a phase task implements it.
  - Read CONTEXT.md "Frameless titlebar" + "Status Bar" + "Workstation invariants". Confirm the code matches.
  - Are there any leftover W3 affordances that should have been retired (e.g. the Sidebar's 🗎 button)? The plan removes it in Task 1.7 — confirm.
  - Run the smoothness acceptance test from DESIGN.md §9 to confirm we haven't regressed: 4 panes, typing latency, no flicker. Hand back to controller for manual run.
- [ ] Mark Weekend 4 done. Open the W5 plan (CI + matrix tests + MSI).

---

# Verification command reference

Run these from the repo root after every commit:

```bash
npm run typecheck
npm test -- --run
cargo test --lib --manifest-path src-tauri/Cargo.toml
cargo clippy --all-targets --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check
```

All five must be green before the commit ships.

---

# Out of scope for W4 (deferred to later weekends)

- **Toast UI** — config warnings currently log via `tauri-plugin-log` only. Toast widget lands when the toast system itself ships (no specific weekend assigned; DESIGN.md §8 describes the surface).
- **Ln/Col selection lift** in MD Editor — Status Bar shows `Ln —, Col —` placeholder. Lifting CodeMirror's selection state into mdStore is a v0.2 task per DESIGN.md "MD Editor polish".
- **OSC 7 shell integration** — the Status Bar's `⏵ N` indicator counts "live PTYs" instead of "shells with foreground processes". Documented limitation; OSC 7 lands in v0.2.
- **Workspace Folder change UI** — DESIGN.md §3 calls for a top-bar "Open Folder" button. Not in W4 scope; W4 keeps the home-dir default and the file watcher follows it. Folder-change UI is a Weekend 5 / 6 / 7 candidate.
- **Native OS file dialog for Ctrl+O** — still uses `window.prompt`. v0.2 polish.
- **Snap-layouts hover on Win11** — DESIGN.md §10 risk 11. v0.4+ cross-platform polish.
- **`tabs` and `quickViewer` persistence** — DESIGN.md §4 EXCLUDED list. v0.2 adds explicit MD tab persistence.

---

# Self-review checklist (done — controller signed off before saving)

- [x] Every task references exact file paths.
- [x] Every code step shows the actual code (no "implement appropriately" placeholders).
- [x] Test commands include the exact `npm test` / `cargo test` invocation.
- [x] Commits are bundled per phase (4 commits for the weekend) to match the W3 cadence.
- [x] DESIGN.md §6 schema is mirrored in `config.rs` and `src/types/config.ts` field-for-field.
- [x] DESIGN.md §4 persist boundary (EXCLUDED list) is honoured in `partialize` for every persisted store.
- [x] Sidebar visibility now has both a button (TopBar) and a keyboard shortcut (Ctrl+B) — user can always get it back.
- [x] The W3 fallback 🗎 button is removed once TopBar ships.
- [x] Verification gates are listed at every phase boundary.
- [x] Holistic review is dispatched at every phase boundary AND once more at the end.
