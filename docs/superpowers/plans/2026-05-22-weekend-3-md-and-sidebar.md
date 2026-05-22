# Weekend 3 Implementation Plan — Markdown + Preview + Sidebar + Shell support

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land DESIGN.md §12 Weekend 3 — Sidebar file tree, Shell detection + per-pane Change Shell menu, Ctrl+Click MD Link, MD Quick Viewer, MD Editor Full View with live preview. Foundation work: theme tokens + bundled fonts.

**Architecture:** Seven sequenced phases, each ending in a clean commit. Phases 0-1 are foundation (theme + fonts). Phases 2-3 add the Sidebar and per-pane menu. Phases 4-5 bring the Quick Viewer online and wire MD Link clicks into it. Phase 6 builds the MD Editor Full View on top of the Quick Viewer's CodeMirror infrastructure. Each phase produces something testable on screen.

**Tech Stack:**
- TS/React side: `@fontsource/inter`, `@fontsource/jetbrains-mono`, `codemirror` (vanilla) + `@codemirror/lang-markdown` + `@codemirror/language-data`, `markdown-it`, `dompurify`
- Rust side: `notify` (file watching), `which` (shell path resolution)
- Existing stack stays: Zustand + immer + devtools, react-resizable-panels, xterm.js, portable-pty

**Acceptance for the whole weekend:**
- Open the app → Sidebar visible on the left rooted at home folder with collapsed-by-default node_modules / .git / etc., 🔍 filter input, ➕ new-file icon
- Right-click a Terminal Pane → context menu with "Change Shell..." submenu listing every detected shell (pwsh, powershell, cmd, each WSL distro)
- Ctrl+Click any `.md` filename inside a Terminal Pane → MD Quick Viewer opens on the right with that file rendered in CodeMirror 6
- Click any `.md` file in the Sidebar → opens in the MD Quick Viewer
- Ctrl+E → MD Editor Full View takes over the centre area, with a Tab Strip at top, CodeMirror editor + live HTML preview pane side-by-side, Inter prose / JetBrains Mono fenced code
- Ctrl+O → opens any .md file on disk into a new MD Editor tab
- Ctrl+S saves the focused MD Editor tab
- Ctrl+W closes the focused MD Editor tab (silent discard for v0.1)
- All 13 colour tokens from DESIGN.md §5 wired through CSS variables; no hard-coded hex outside `theme.css`

**Phase commits at the end of the weekend (target):**
- 21: `feat(theme): wire DESIGN.md tokens through CSS variables`
- 22: `feat(fonts): bundle Inter + JetBrains Mono woff2`
- 23: `feat(sidebar): file tree with filter, new-file, lazy collapse, watcher`
- 24: `feat(shell): auto-detect + per-pane Change Shell context menu`
- 25: `feat(md): Quick Viewer Panel with CodeMirror 6`
- 26: `feat(terminal): Ctrl+Click MD Link opens Quick Viewer`
- 27: `feat(md): MD Editor Full View with tabs + live preview pane`

---

## File structure delivered by this plan

### New TypeScript files
| Path | Responsibility |
|---|---|
| `src/styles/theme.css` | All 13 colour tokens + radius/spacing as CSS custom properties on `:root`. Single source for the Amber-on-Black palette. |
| `src/styles/fonts.css` | `@font-face` + body-level family stacks for Inter and JetBrains Mono. |
| `src/store/sidebarStore.ts` | Zustand slice: workspaceFolder, tree state, expandedPaths Set, filterText, async loadDir(path), refreshDir(path) |
| `src/store/mdStore.ts` | Zustand slice: mdEditorMode (off/full), tabs[], activeTabId, quickViewer { open, path, content, dirty }, openMdInQuickViewer(path), openMdTab(path), closeMdTab(id), saveMdTab(id) |
| `src/store/contextMenuStore.ts` | Zustand slice for the single-instance right-click menu: { open, x, y, items[] } |
| `src/components/Sidebar.tsx` | Sidebar root with header (filter + new file) + tree. |
| `src/components/SidebarTree.tsx` | Recursive tree row renderer. |
| `src/components/SidebarRow.tsx` | One file-or-folder row (indent, chevron, icon, label, hover/selection). |
| `src/components/ContextMenu.tsx` | Single floating context menu component bound to contextMenuStore. |
| `src/components/QuickViewer.tsx` | Right-side Panel wrapping a CodeMirror 6 instance bound to mdStore.quickViewer. |
| `src/components/MdEditor.tsx` | MD Editor Full View root: TabStrip + Editor + PreviewPane. |
| `src/components/MdEditorTabStrip.tsx` | Tab chip row at top of MD Editor. |
| `src/components/MdEditorPreview.tsx` | markdown-it + DOMPurify HTML pane, debounced re-render, rAF scroll sync. |
| `src/codemirror/setup.ts` | Factory that builds a CodeMirror 6 EditorView with our extensions (markdown, dark theme, line numbers, keymap). Shared by Quick Viewer and MD Editor. |
| `src/codemirror/markdownExtensions.ts` | `@codemirror/lang-markdown` config with the ~10 nested languages from DESIGN.md §4. |
| `src/codemirror/theme.ts` | CodeMirror dark theme mapped onto our CSS tokens. |
| `src/preview/renderMarkdown.ts` | markdown-it + DOMPurify wrapper. Pure function `(src: string) => string` (HTML). |
| `src/terminals/mdLinkProvider.ts` | Builds the xterm.js link provider config (regex, hover, activate). |
| `src/lib/fsClient.ts` | TS wrapper around the new Rust fs commands (`list_dir`, `read_text_file`, `write_text_file`, `pick_md_file`). |
| `src/lib/shellsClient.ts` | TS wrapper around `detect_shells`. |
| `src/lib/fileWatcher.ts` | TS side of the file watcher Channel. |
| `src/types/fs.ts` | TS types mirroring Rust DirEntry, ShellDescriptor. |

### New Rust files
| Path | Responsibility |
|---|---|
| `src-tauri/src/fs.rs` | `list_dir`, `read_text_file`, `write_text_file`, `pick_md_file` commands; types `DirEntry`. |
| `src-tauri/src/shell_detect.rs` | `detect_shells` command + `which` lookups + `wsl.exe -l -v` parsing. |
| `src-tauri/src/file_watcher.rs` | `watch_workspace` command using `notify`; per-Workstation Channel emitting fs events. |

### Files this plan modifies
- `src/main.tsx` — import theme.css + fonts.css
- `src/App.tsx` — render Sidebar + Tiling Area + Quick Viewer + (when MD mode is on) MdEditor in place of Tiling Area
- `src/components/PaneTree.tsx` — read border colour from `var(--border)` instead of hard-coded hex
- `src/components/TerminalPane.tsx` — onContextMenu opens shell menu; remove hard-coded background hex
- `src/terminals/registry.ts` — register the MD link provider on terminal init
- `src/hooks/useKeyboardShortcuts.ts` — add Ctrl+E (MD mode toggle), Ctrl+Shift+M (Quick Viewer toggle), Ctrl+O (open file), Ctrl+S (save), Ctrl+Tab (cycle tabs)
- `src-tauri/src/lib.rs` — register fs, shell_detect, file_watcher commands
- `src-tauri/Cargo.toml` — add `notify`, `which`
- `package.json` — add `@fontsource/inter`, `@fontsource/jetbrains-mono`, `codemirror`, `@codemirror/lang-markdown`, `@codemirror/language-data`, `@codemirror/state`, `@codemirror/view`, `markdown-it`, `dompurify`, `@types/markdown-it`, `@types/dompurify`
- `src/types/index.ts` — keep Shell shape but document the wsl variant carries `distro` and the menu builds labels from that

---

## Phase 0 — Theme tokens to CSS variables

Goal: Every existing hard-coded colour in the codebase is replaced by a `var(--token)`. Adding new components in later phases will use the same tokens.

### Task 0.1: Create theme.css with all DESIGN.md §5 tokens

**Files:**
- Create: `src/styles/theme.css`

- [ ] **Step 1: Write the file**

```css
/* DESIGN.md §5 — "Amber on Black" palette. Single source of truth for
 * colour tokens. Anything that needs a colour should reference these
 * variables, not a raw hex. v0.2's accent presets swap only --accent* —
 * everything else stays. */

:root {
  /* Surfaces */
  --bg-0: #0a0a0a;
  --bg-1: #111111;
  --bg-2: #1a1a1a;
  --bg-3: #222222;

  /* Foreground */
  --fg-0: #e6e6e6;
  --fg-1: #9a9a9a;
  --fg-2: #6a6a6a;
  --fg-heading: #ffffff;

  /* Amber accent */
  --accent: #d4a85c;
  --accent-alpha: rgba(212, 168, 92, 0.3);
  --accent-dim: #a07c3f;

  /* State */
  --error: #e85a5a;
  --success: #7fc26b;

  /* Chrome */
  --border: #222222;

  /* Geometry — small set of utility tokens used by component CSS */
  --radius-sm: 4px;
  --radius-md: 6px;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
}
```

- [ ] **Step 2: Smoke-test in app**

Run: `npm run tauri dev`
Open DevTools → Computed → confirm `--bg-0` resolves to `#0a0a0a` on `:root`.

### Task 0.2: Declare `.module.css` typings for TypeScript

CSS-module imports (`import styles from "./X.module.css"`) need a TS type declaration or `tsc --noEmit` fails. Vite already handles the runtime side; we just need to teach TypeScript.

**Files:**
- Modify: `src/vite-env.d.ts`

- [ ] **Step 1: Append CSS-module declaration**

Append to `src/vite-env.d.ts`:

```ts
declare module "*.module.css" {
  const classes: { readonly [key: string]: string };
  export default classes;
}
```

- [ ] **Step 2: Confirm typecheck still clean**

```bash
npm run typecheck
```

Expected: zero errors. (No `.module.css` files exist yet — this is groundwork for Phase 2 onward.)

### Task 0.3: Import theme.css in main.tsx and replace hard-coded colours

**Files:**
- Modify: `src/main.tsx`
- Modify: `src/App.tsx`
- Modify: `src/components/PaneTree.tsx`
- Modify: `src/components/TerminalPane.tsx`

- [ ] **Step 1: Import theme.css at the top of `src/main.tsx`**

```ts
import "@/styles/theme.css";
import "@/styles/xterm-overrides.css";
import "@xterm/xterm/css/xterm.css";
// ...existing imports
```

- [ ] **Step 2: Replace `App.tsx` inline `#0a0a0a` and `#555`**

Change `background: "#0a0a0a"` → `background: "var(--bg-0)"`, and `color: "#555"` → `color: "var(--fg-2)"`.

- [ ] **Step 3: Replace `PaneTree.tsx` border + background hex**

Change `border: "1px solid #181818"` → `border: "1px solid var(--border)"`, `background: "#0a0a0a"` → `background: "var(--bg-0)"`, `background: "#181818"` (the splitter handle) → `background: "var(--border)"`, and the pane-id badge `color: focused ? "#888" : "#333"` → `color: focused ? "var(--fg-1)" : "var(--fg-2)"`.

- [ ] **Step 4: Replace `TerminalPane.tsx` `background: "#0a0a0a"`** → `background: "var(--bg-0)"`.

- [ ] **Step 5: Visual smoke test**

Run: `npm run tauri dev`
Expected: The app looks identical to before. (If anything changed visibly, you mismapped a token.)

- [ ] **Step 6: Commit**

```bash
git add src/styles/theme.css src/vite-env.d.ts src/main.tsx src/App.tsx src/components/PaneTree.tsx src/components/TerminalPane.tsx
git commit -m "feat(theme): wire DESIGN.md tokens through CSS variables"
```

---

## Phase 1 — Bundle Inter + JetBrains Mono

Goal: Both fonts ship inside the binary as woff2; UI surfaces (top bar, sidebar, tabs) get Inter; terminals + fenced code get JetBrains Mono.

### Task 1.1: Add @fontsource packages

**Files:**
- Modify: `package.json` (via npm install)

- [ ] **Step 1: Install**

```bash
npm install @fontsource-variable/inter @fontsource-variable/jetbrains-mono
```

Expected: `package.json` gains the two deps, ~600KB woff2 added to node_modules.

### Task 1.2: Create fonts.css

**Files:**
- Create: `src/styles/fonts.css`

- [ ] **Step 1: Write the file**

```css
/* Bundle two font families inside the binary. @fontsource-variable ships
 * variable woff2 files so we get all weights from one file per family.
 * System fallbacks are listed in DESIGN.md §5. */

@import "@fontsource-variable/inter/index.css";
@import "@fontsource-variable/jetbrains-mono/index.css";

:root {
  --font-ui: "Inter Variable", -apple-system, "Segoe UI Variable", "Segoe UI", system-ui, sans-serif;
  --font-mono: "JetBrains Mono Variable", "Consolas", "Cascadia Mono", ui-monospace, monospace;
}

html, body, #root {
  font-family: var(--font-ui);
  font-feature-settings: "cv11", "ss01"; /* Inter typographic refinements */
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
```

- [ ] **Step 2: Import in `src/main.tsx`**

Add `import "@/styles/fonts.css";` after the theme import.

- [ ] **Step 3: Update xterm Terminal options to use the mono token**

Open `src/terminals/registry.ts`. Find the `new Terminal({...})` constructor call. Set `fontFamily: getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim() || 'JetBrains Mono Variable, Consolas, monospace'`. (Reading the CSS var keeps it consistent with the rest of the app.)

- [ ] **Step 4: Visual smoke test**

Run: `npm run tauri dev`
Expected: The pane-id badge in the top-right of each pane (rendered in `var(--font-ui)`) now appears in Inter. Terminal content stays mono.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/styles/fonts.css src/main.tsx src/terminals/registry.ts
git commit -m "feat(fonts): bundle Inter + JetBrains Mono woff2"
```

---

## Phase 2 — Sidebar with file tree, filter, new-file, watcher

Goal: A working left Sidebar rooted at the user's home folder. Click a folder to expand/collapse. Type in the filter to narrow visible files. Click ➕ to create a new `.md`. File watcher refreshes the tree when an external process writes a file.

### Task 2.1: Rust `fs.rs` with list_dir + read_text_file + write_text_file commands

**Files:**
- Create: `src-tauri/src/fs.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add Cargo deps**

In `src-tauri/Cargo.toml` under `[dependencies]`:

```toml
notify = "6.1"
which = "6.0"
dirs = "5.0"
```

- [ ] **Step 2: Create `src-tauri/src/fs.rs`**

```rust
// File-system commands for the Sidebar + MD editor.
//
// SECURITY NOTE: these commands operate with the user's privilege, so
// callers can already do anything the user can. We do NOT sandbox to a
// "workspace root" here — the user explicitly opens files via the
// Sidebar / MD picker, and the spec puts Workspace Folder selection on
// the user (DESIGN.md §3 Workspace Folder). Validation we DO apply:
//   - canonicalise the path so symlink-traversal returns the real path
//   - return a typed AppError on permission / not-found / IO failure

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct DirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    /// File size in bytes (0 for dirs).
    pub size: u64,
    /// Last modified epoch ms (None if filesystem doesn't expose it).
    pub modified_ms: Option<i64>,
}

fn to_entry(entry: &fs::DirEntry) -> AppResult<DirEntry> {
    let meta = entry
        .metadata()
        .map_err(|e| AppError::Internal { reason: format!("metadata {}: {}", entry.path().display(), e) })?;
    let modified_ms = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64);
    Ok(DirEntry {
        name: entry.file_name().to_string_lossy().to_string(),
        path: entry.path().to_string_lossy().to_string(),
        is_dir: meta.is_dir(),
        size: if meta.is_dir() { 0 } else { meta.len() },
        modified_ms,
    })
}

#[tauri::command]
pub fn list_dir(path: String) -> AppResult<Vec<DirEntry>> {
    let p = PathBuf::from(&path);
    let canonical = p
        .canonicalize()
        .map_err(|e| AppError::Internal { reason: format!("canonicalize {}: {}", path, e) })?;
    let read = fs::read_dir(&canonical)
        .map_err(|e| AppError::Internal { reason: format!("read_dir {}: {}", canonical.display(), e) })?;
    let mut out = Vec::new();
    for entry in read.flatten() {
        if let Ok(e) = to_entry(&entry) {
            out.push(e);
        }
    }
    // Folders first, then alphabetical within each group. Matches VSCode / Finder default.
    out.sort_by(|a, b| match (a.is_dir, b.is_dir) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => a.name.to_lowercase().cmp(&b.name.to_lowercase()),
    });
    Ok(out)
}

#[tauri::command]
pub fn read_text_file(path: String) -> AppResult<String> {
    fs::read_to_string(&path)
        .map_err(|e| AppError::Internal { reason: format!("read {}: {}", path, e) })
}

#[tauri::command]
pub fn write_text_file(path: String, contents: String) -> AppResult<()> {
    if let Some(parent) = Path::new(&path).parent() {
        if !parent.exists() {
            fs::create_dir_all(parent)
                .map_err(|e| AppError::Internal { reason: format!("create_dir_all {}: {}", parent.display(), e) })?;
        }
    }
    fs::write(&path, contents)
        .map_err(|e| AppError::Internal { reason: format!("write {}: {}", path, e) })
}

#[tauri::command]
pub fn home_dir() -> AppResult<String> {
    dirs::home_dir()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| AppError::Internal { reason: "home dir unavailable".to_string() })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn list_dir_returns_folders_first_alphabetical() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir(dir.path().join("zzz_folder")).unwrap();
        fs::create_dir(dir.path().join("aaa_folder")).unwrap();
        let mut f = fs::File::create(dir.path().join("a_file.md")).unwrap();
        writeln!(f, "hi").unwrap();
        let mut f = fs::File::create(dir.path().join("z_file.md")).unwrap();
        writeln!(f, "hi").unwrap();
        let entries = list_dir(dir.path().to_string_lossy().to_string()).unwrap();
        let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
        assert_eq!(names, vec!["aaa_folder", "zzz_folder", "a_file.md", "z_file.md"]);
    }

    #[test]
    fn read_then_write_roundtrips() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("test.md").to_string_lossy().to_string();
        write_text_file(path.clone(), "hello".to_string()).unwrap();
        assert_eq!(read_text_file(path).unwrap(), "hello");
    }
}
```

- [ ] **Step 3: Add `tempfile = "3"` to `[dev-dependencies]` in `src-tauri/Cargo.toml`**

```toml
[dev-dependencies]
tempfile = "3"
```

- [ ] **Step 4: Register the commands in `src-tauri/src/lib.rs`**

In the existing `tauri::Builder::default()` chain find the `.invoke_handler(tauri::generate_handler![...])` call and add `crate::fs::list_dir, crate::fs::read_text_file, crate::fs::write_text_file, crate::fs::home_dir` to the list.

Add `mod fs;` at the top of `lib.rs` alongside `mod pty; mod error;`.

- [ ] **Step 5: Run cargo tests**

```bash
cd src-tauri && cargo test --lib
```

Expected: 13 tests pass (11 existing + 2 new). `cargo fmt --check` + `cargo clippy -D warnings` clean.

### Task 2.2: TS client wrapper + types

**Files:**
- Create: `src/types/fs.ts`
- Create: `src/lib/fsClient.ts`

- [ ] **Step 1: Create `src/types/fs.ts`**

```ts
/** Mirror of Rust `DirEntry` (src-tauri/src/fs.rs). */
export interface DirEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified_ms: number | null;
}
```

- [ ] **Step 2: Create `src/lib/fsClient.ts`**

```ts
import { invoke } from "@tauri-apps/api/core";
import type { DirEntry } from "@/types/fs";

export function listDir(path: string): Promise<DirEntry[]> {
  return invoke<DirEntry[]>("list_dir", { path });
}

export function readTextFile(path: string): Promise<string> {
  return invoke<string>("read_text_file", { path });
}

export function writeTextFile(path: string, contents: string): Promise<void> {
  return invoke<void>("write_text_file", { path, contents });
}

export function homeDir(): Promise<string> {
  return invoke<string>("home_dir");
}
```

### Task 2.3: sidebarStore

**Files:**
- Create: `src/store/sidebarStore.ts`
- Create: `src/store/sidebarStore.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, beforeEach } from "vitest";
import { useSidebarStore } from "@/store/sidebarStore";
import type { DirEntry } from "@/types/fs";

const fakeEntry = (name: string, isDir: boolean, parent: string): DirEntry => ({
  name,
  path: `${parent}/${name}`,
  is_dir: isDir,
  size: isDir ? 0 : 100,
  modified_ms: null,
});

describe("sidebarStore", () => {
  beforeEach(() => {
    useSidebarStore.getState().reset();
  });

  it("starts with no workspace and empty entries", () => {
    const s = useSidebarStore.getState();
    expect(s.workspaceFolder).toBeNull();
    expect(s.entries.size).toBe(0);
    expect(s.expanded.size).toBe(0);
  });

  it("setWorkspaceFolder records the path", () => {
    useSidebarStore.getState().setWorkspaceFolder("/home/u");
    expect(useSidebarStore.getState().workspaceFolder).toBe("/home/u");
  });

  it("storeEntries replaces the entries for a path", () => {
    const entries = [fakeEntry("a.md", false, "/home/u")];
    useSidebarStore.getState().storeEntries("/home/u", entries);
    expect(useSidebarStore.getState().entries.get("/home/u")).toEqual(entries);
  });

  it("toggleExpanded flips a path", () => {
    useSidebarStore.getState().toggleExpanded("/home/u/folder");
    expect(useSidebarStore.getState().expanded.has("/home/u/folder")).toBe(true);
    useSidebarStore.getState().toggleExpanded("/home/u/folder");
    expect(useSidebarStore.getState().expanded.has("/home/u/folder")).toBe(false);
  });

  it("setFilter records the lowercase filter text", () => {
    useSidebarStore.getState().setFilter("README");
    expect(useSidebarStore.getState().filterText).toBe("readme");
  });

  it("matchesFilter returns true for any entry when filter is empty", () => {
    useSidebarStore.getState().setFilter("");
    expect(useSidebarStore.getState().matchesFilter("anything.md")).toBe(true);
  });

  it("matchesFilter is case-insensitive substring", () => {
    useSidebarStore.getState().setFilter("read");
    expect(useSidebarStore.getState().matchesFilter("README.md")).toBe(true);
    expect(useSidebarStore.getState().matchesFilter("CHANGELOG.md")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test, see it fail**

```bash
npm test -- --run src/store/sidebarStore.test.ts
```

Expected: FAIL — `Cannot find module '@/store/sidebarStore'`.

- [ ] **Step 3: Write the store**

```ts
// src/store/sidebarStore.ts
import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import type { DirEntry } from "@/types/fs";

/** Folder names rendered collapsed-by-default (DESIGN.md §3). */
export const COLLAPSED_DIRS: ReadonlySet<string> = new Set([
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
]);

export interface SidebarState {
  workspaceFolder: string | null;
  /** path → its direct children (already loaded). */
  entries: Map<string, DirEntry[]>;
  /** Set of expanded folder paths. */
  expanded: Set<string>;
  filterText: string;

  // actions
  setWorkspaceFolder: (path: string) => void;
  storeEntries: (path: string, entries: DirEntry[]) => void;
  toggleExpanded: (path: string) => void;
  setFilter: (text: string) => void;
  matchesFilter: (name: string) => boolean;
  reset: () => void;
}

export const useSidebarStore = create<SidebarState>()(
  devtools(
    immer((set, get) => ({
      workspaceFolder: null,
      entries: new Map(),
      expanded: new Set(),
      filterText: "",

      setWorkspaceFolder: (path) =>
        set((s) => {
          s.workspaceFolder = path;
        }),

      storeEntries: (path, entries) =>
        set((s) => {
          s.entries.set(path, entries);
        }),

      toggleExpanded: (path) =>
        set((s) => {
          if (s.expanded.has(path)) s.expanded.delete(path);
          else s.expanded.add(path);
        }),

      setFilter: (text) =>
        set((s) => {
          s.filterText = text.toLowerCase();
        }),

      matchesFilter: (name) => {
        const f = get().filterText;
        return f === "" || name.toLowerCase().includes(f);
      },

      reset: () =>
        set((s) => {
          s.workspaceFolder = null;
          s.entries = new Map();
          s.expanded = new Set();
          s.filterText = "";
        }),
    })),
    { name: "sidebarStore" }
  )
);
```

- [ ] **Step 4: Run tests**

```bash
npm test -- --run src/store/sidebarStore.test.ts
```

Expected: PASS — 7 tests green.

### Task 2.4: Sidebar visual design lock — CSS module for row, header, chevron

**Files:**
- Create: `src/components/Sidebar.module.css`

- [ ] **Step 1: Write the file**

```css
/* Sidebar visual design. Inherits all colour from theme.css tokens. */

.sidebar {
  width: 240px;
  background: var(--bg-1);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  font-family: var(--font-ui);
  font-size: 13px;
  color: var(--fg-0);
  user-select: none;
  overflow: hidden;
}

.header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border);
  background: var(--bg-1);
}

.filter {
  flex: 1;
  background: var(--bg-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--fg-0);
  font-family: var(--font-ui);
  font-size: 12px;
  padding: 4px var(--space-2);
  outline: none;
}

.filter::placeholder {
  color: var(--fg-2);
}

.filter:focus {
  border-color: var(--accent-dim);
}

.iconButton {
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--fg-1);
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
}

.iconButton:hover {
  background: var(--bg-2);
  color: var(--fg-0);
}

.tree {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-1) 0;
}

.row {
  display: flex;
  align-items: center;
  height: 22px;
  padding-right: var(--space-2);
  color: var(--fg-0);
  cursor: pointer;
  white-space: nowrap;
}

.row:hover {
  background: var(--bg-2);
}

.row.selected {
  background: var(--accent-alpha);
}

.row.dim {
  color: var(--fg-2);
}

.chevron {
  width: 16px;
  display: inline-flex;
  justify-content: center;
  color: var(--fg-2);
  font-size: 10px;
}

.chevron.placeholder {
  visibility: hidden;
}

.icon {
  width: 16px;
  display: inline-flex;
  justify-content: center;
  color: var(--fg-1);
  font-size: 12px;
  margin-right: var(--space-1);
}

.label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

### Task 2.5: SidebarRow + SidebarTree components

**Files:**
- Create: `src/components/SidebarRow.tsx`
- Create: `src/components/SidebarTree.tsx`

- [ ] **Step 1: SidebarRow**

```tsx
// One file-or-folder row. Visual only; container handles click logic.
import styles from "@/components/Sidebar.module.css";

interface Props {
  name: string;
  isDir: boolean;
  depth: number;
  expanded: boolean;
  selected: boolean;
  dimmed: boolean;
  onClick: () => void;
}

export function SidebarRow({ name, isDir, depth, expanded, selected, dimmed, onClick }: Props) {
  const indent = depth * 12;
  const chevron = isDir ? (expanded ? "▾" : "▸") : "";
  const icon = isDir ? "▢" : name.endsWith(".md") ? "✎" : "·";
  const rowClass = [
    styles.row,
    selected ? styles.selected : "",
    dimmed ? styles.dim : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={rowClass} style={{ paddingLeft: indent }} onClick={onClick}>
      <span className={isDir ? styles.chevron : `${styles.chevron} ${styles.placeholder}`}>{chevron}</span>
      <span className={styles.icon}>{icon}</span>
      <span className={styles.label}>{name}</span>
    </div>
  );
}
```

- [ ] **Step 2: SidebarTree**

NOTE — phase ordering: Phase 2 wires folder expand/collapse and lists files. `.md` file clicks do nothing yet. Phase 4 (Task 4.5 step "Wire Sidebar .md click into Quick Viewer") will add the openMdInQuickViewer call. This keeps Phase 2 self-contained — no import of mdStore which doesn't exist until Phase 4.

```tsx
// Recursive renderer. Reads sidebarStore. Triggers lazy listDir when a folder
// is expanded for the first time.
import { useEffect } from "react";

import { SidebarRow } from "@/components/SidebarRow";
import { useSidebarStore, COLLAPSED_DIRS } from "@/store/sidebarStore";
import { listDir } from "@/lib/fsClient";

interface Props {
  path: string;
  depth: number;
}

export function SidebarTree({ path, depth }: Props) {
  const entries = useSidebarStore((s) => s.entries.get(path));
  const expanded = useSidebarStore((s) => s.expanded);
  const matchesFilter = useSidebarStore((s) => s.matchesFilter);
  const toggleExpanded = useSidebarStore((s) => s.toggleExpanded);
  const storeEntries = useSidebarStore((s) => s.storeEntries);

  useEffect(() => {
    if (entries === undefined) {
      listDir(path)
        .then((es) => storeEntries(path, es))
        .catch(() => storeEntries(path, []));
    }
  }, [path, entries, storeEntries]);

  if (entries === undefined) return null;

  return (
    <>
      {entries
        .filter((e) => e.is_dir || matchesFilter(e.name))
        .map((entry) => {
          const isExpanded = expanded.has(entry.path);
          const dimmed = entry.is_dir && COLLAPSED_DIRS.has(entry.name) && !isExpanded;
          const onClick = () => {
            if (entry.is_dir) {
              toggleExpanded(entry.path);
            }
            // .md file clicks are a no-op in Phase 2; Phase 4 wires them
            // into the Quick Viewer once mdStore exists.
          };
          return (
            <div key={entry.path}>
              <SidebarRow
                name={entry.name}
                isDir={entry.is_dir}
                depth={depth}
                expanded={isExpanded}
                selected={false}
                dimmed={dimmed}
                onClick={onClick}
              />
              {entry.is_dir && isExpanded && (
                <SidebarTree path={entry.path} depth={depth + 1} />
              )}
            </div>
          );
        })}
    </>
  );
}
```

### Task 2.6: Sidebar root component with header + workspace bootstrap

**Files:**
- Create: `src/components/Sidebar.tsx`

- [ ] **Step 1: Write the file**

```tsx
// Sidebar root: header (filter + new file) + tree. On first mount, sets
// the workspace folder to home dir if it isn't already set.
import { useEffect } from "react";

import styles from "@/components/Sidebar.module.css";
import { SidebarTree } from "@/components/SidebarTree";
import { useSidebarStore } from "@/store/sidebarStore";
import { homeDir, writeTextFile } from "@/lib/fsClient";

export function Sidebar() {
  const workspaceFolder = useSidebarStore((s) => s.workspaceFolder);
  const filterText = useSidebarStore((s) => s.filterText);
  const setFilter = useSidebarStore((s) => s.setFilter);
  const setWorkspaceFolder = useSidebarStore((s) => s.setWorkspaceFolder);

  useEffect(() => {
    if (workspaceFolder === null) {
      void homeDir().then((h) => setWorkspaceFolder(h));
    }
  }, [workspaceFolder, setWorkspaceFolder]);

  const onNewFile = async () => {
    if (workspaceFolder === null) return;
    const name = window.prompt("New file name (relative to workspace)");
    if (!name) return;
    const path = `${workspaceFolder}/${name.endsWith(".md") ? name : `${name}.md`}`;
    try {
      await writeTextFile(path, "");
      // Phase 4 will open the newly-created file in the MD Editor.
      // For Phase 2 the file simply exists on disk and the watcher
      // surfaces it in the tree.
    } catch (e) {
      console.error("new file failed", e);
    }
  };

  if (workspaceFolder === null) {
    return <div className={styles.sidebar}>loading…</div>;
  }

  return (
    <div className={styles.sidebar}>
      <div className={styles.header}>
        <input
          className={styles.filter}
          type="text"
          placeholder="🔍 filter"
          value={filterText}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button className={styles.iconButton} title="New .md file" onClick={onNewFile}>
          ＋
        </button>
      </div>
      <div className={styles.tree}>
        <SidebarTree path={workspaceFolder} depth={0} />
      </div>
    </div>
  );
}
```

### Task 2.7: Mount Sidebar in App.tsx with a left rail

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Wrap PaneTree in a horizontal flex layout with Sidebar on the left**

Replace the root return-element of `App.tsx` with:

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
    <div style={{ flex: 1, position: "relative", padding: 1, minWidth: 0 }}>
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
    </div>
  </div>
);
```

Add `import { Sidebar } from "@/components/Sidebar";` at the top.

Also remove the `Sidebar.tsx` reference to `useMdStore` / `openMdTab` — that import only becomes valid in Phase 4. Replace the `onNewFile` body's `await openMdTab(path);` with a placeholder comment `// Phase 4 will open this in the MD Editor; for Phase 2 the file simply exists on disk and shows up in the tree via the file watcher.`

- [ ] **Step 2: Visual smoke test**

Run: `npm run tauri dev`
Expected:
- Sidebar visible on left, ~240px wide
- Home folder contents listed, folders before files
- `node_modules`, `.git`, etc. render dim and collapsed
- Click a folder → its contents load and render
- Type in 🔍 filter → file names filter (folders stay visible so you can drill in)
- Click ＋ → prompt appears, creating a `.md` file with that name in workspace root

### Task 2.8: Rust file watcher

**Files:**
- Create: `src-tauri/src/file_watcher.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write the watcher**

```rust
// File-watcher Channel for the Sidebar's tree refresh.
//
// Architecture: a single per-Workstation watcher rooted at the current
// workspace folder. When notify emits a fs event for a file/folder, we
// emit a FsEvent over a Tauri Channel that the JS side subscribes to.
// JS picks the parent folder of the changed path, invalidates that
// folder's entries in sidebarStore, and triggers a re-listDir.
//
// notify v6 is debounced internally; we don't add another debounce here.

use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use parking_lot::Mutex;
use serde::Serialize;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::ipc::Channel;
use tauri::State;

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FsEvent {
    Created { path: String },
    Modified { path: String },
    Removed { path: String },
    Rescan,
}

/// Holder for the active watcher. Replaced when workspace folder changes.
#[derive(Default)]
pub struct FileWatcherState(pub Mutex<Option<RecommendedWatcher>>);

#[tauri::command]
pub fn watch_workspace(
    state: State<'_, FileWatcherState>,
    root: String,
    channel: Channel<FsEvent>,
) -> AppResult<()> {
    let channel = Arc::new(channel);
    let chan_clone = channel.clone();
    let mut watcher = notify::recommended_watcher(move |res: notify::Result<Event>| {
        if let Ok(event) = res {
            let path = event
                .paths
                .first()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();
            let out = match event.kind {
                EventKind::Create(_) => FsEvent::Created { path },
                EventKind::Modify(_) => FsEvent::Modified { path },
                EventKind::Remove(_) => FsEvent::Removed { path },
                _ => return,
            };
            let _ = chan_clone.send(out);
        }
    })
    .map_err(|e| AppError::Internal { reason: format!("watcher create: {}", e) })?;

    watcher
        .configure(Config::default().with_compare_contents(false))
        .map_err(|e| AppError::Internal { reason: format!("watcher config: {}", e) })?;
    watcher
        .watch(&PathBuf::from(&root), RecursiveMode::Recursive)
        .map_err(|e| AppError::Internal { reason: format!("watch {}: {}", root, e) })?;

    // Replace any previous watcher (drops the old one, releasing handles).
    *state.0.lock() = Some(watcher);

    // Emit one Rescan so the JS side seeds its tree.
    channel
        .send(FsEvent::Rescan)
        .map_err(|e| AppError::Internal { reason: format!("channel send: {}", e) })?;
    Ok(())
}
```

- [ ] **Step 2: Register in `lib.rs`**

In `src-tauri/src/lib.rs` add `mod file_watcher;`, register `tauri::Builder::default().manage(file_watcher::FileWatcherState::default())`, and add `crate::file_watcher::watch_workspace` to the `generate_handler!` list.

- [ ] **Step 3: Write TS side**

```ts
// src/lib/fileWatcher.ts
import { Channel, invoke } from "@tauri-apps/api/core";

export type FsEvent =
  | { kind: "created"; path: string }
  | { kind: "modified"; path: string }
  | { kind: "removed"; path: string }
  | { kind: "rescan" };

export function watchWorkspace(root: string, onEvent: (e: FsEvent) => void): void {
  const channel = new Channel<FsEvent>();
  channel.onmessage = onEvent;
  void invoke<void>("watch_workspace", { root, channel });
}
```

- [ ] **Step 4: Wire in Sidebar.tsx**

In `Sidebar.tsx`, add a `useEffect` that calls `watchWorkspace(workspaceFolder, handleEvent)` when `workspaceFolder` becomes non-null. The handler should compute the parent dir of `event.path` and re-call `listDir(parent)` + `storeEntries(parent, entries)`. Pseudocode:

```ts
useEffect(() => {
  if (workspaceFolder === null) return;
  watchWorkspace(workspaceFolder, (e) => {
    if (e.kind === "rescan") {
      void listDir(workspaceFolder).then((es) => storeEntries(workspaceFolder, es));
      return;
    }
    const parent = e.path.replace(/[/\\][^/\\]+$/, "");
    if (parent.length > 0) {
      void listDir(parent).then((es) => storeEntries(parent, es)).catch(() => undefined);
    }
  });
}, [workspaceFolder, storeEntries]);
```

- [ ] **Step 5: Smoke test the watcher**

In a Terminal Pane: `New-Item -Path "$env:USERPROFILE\watcher-test.md" -ItemType File`
Expected: file appears in Sidebar within ~1 second.
Then `Remove-Item "$env:USERPROFILE\watcher-test.md"`
Expected: row vanishes.

- [ ] **Step 6: Run all tests**

```bash
npm test -- --run
cd src-tauri && cargo test --lib && cargo clippy --all-targets -- -D warnings && cargo fmt --all -- --check
```

Expected: 76 vitest tests pass (69 + 7 new), 13 cargo tests pass, clippy + fmt clean.

- [ ] **Step 7: Commit phase 2**

```bash
git add src-tauri/Cargo.toml src-tauri/src/fs.rs src-tauri/src/file_watcher.rs src-tauri/src/lib.rs \
        src/types/fs.ts src/lib/fsClient.ts src/lib/fileWatcher.ts \
        src/store/sidebarStore.ts src/store/sidebarStore.test.ts \
        src/components/Sidebar.tsx src/components/Sidebar.module.css \
        src/components/SidebarRow.tsx src/components/SidebarTree.tsx \
        src/App.tsx
git commit -m "feat(sidebar): file tree with filter, new-file, lazy collapse, watcher"
```

---

## Phase 3 — Shell auto-detection + per-pane Change Shell menu

Goal: First launch detects available shells (pwsh, powershell, cmd, every installed WSL distro). Right-click a Terminal Pane → context menu with "Change Shell..." → submenu lists each shell → clicking re-spawns the PTY with that shell.

### Task 3.1: Rust shell_detect.rs

**Files:**
- Create: `src-tauri/src/shell_detect.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Write the detector**

```rust
// Shell auto-detection (DESIGN.md §12 W3 #8).
//
// On Windows we check for pwsh.exe (PowerShell 7+) and powershell.exe
// (Windows PowerShell 5.1) via the `which` crate, plus cmd.exe which is
// always present at %SystemRoot%\System32\cmd.exe. WSL distros come from
// `wsl.exe -l -v` parsing.
//
// Cross-platform note: on macOS/Linux we'd detect /bin/zsh, /bin/bash,
// /usr/local/bin/fish via `which`. Defer cross-platform impl until macOS
// build matters (v0.2).

use serde::Serialize;
use std::process::Command;

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ShellDescriptor {
    Pwsh { path: String },
    Powershell { path: String },
    Cmd { path: String },
    Wsl { distro: String },
}

#[cfg(target_os = "windows")]
fn detect_wsl_distros() -> Vec<String> {
    let Ok(output) = Command::new("wsl.exe").args(["-l", "-q"]).output() else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    // wsl.exe -l -q outputs UTF-16LE on Windows. Decode it.
    let utf16: Vec<u16> = output.stdout.chunks_exact(2).map(|b| u16::from_le_bytes([b[0], b[1]])).collect();
    let text = String::from_utf16_lossy(&utf16);
    text.lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty() && l.to_lowercase() != "docker-desktop")
        .collect()
}

#[cfg(not(target_os = "windows"))]
fn detect_wsl_distros() -> Vec<String> {
    Vec::new()
}

#[tauri::command]
pub fn detect_shells() -> AppResult<Vec<ShellDescriptor>> {
    let mut out = Vec::new();
    if let Ok(p) = which::which("pwsh") {
        out.push(ShellDescriptor::Pwsh { path: p.to_string_lossy().to_string() });
    }
    if let Ok(p) = which::which("powershell") {
        out.push(ShellDescriptor::Powershell { path: p.to_string_lossy().to_string() });
    }
    if let Ok(p) = which::which("cmd") {
        out.push(ShellDescriptor::Cmd { path: p.to_string_lossy().to_string() });
    }
    for distro in detect_wsl_distros() {
        out.push(ShellDescriptor::Wsl { distro });
    }
    if out.is_empty() {
        return Err(AppError::Internal { reason: "no shells detected".to_string() });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_shells_includes_at_least_one_on_test_host() {
        // CI runs on windows-latest which always has cmd.exe at minimum.
        let shells = detect_shells().unwrap();
        assert!(!shells.is_empty());
    }
}
```

- [ ] **Step 2: Register in `lib.rs`**

Add `mod shell_detect;` and `crate::shell_detect::detect_shells` to the `generate_handler!` list.

- [ ] **Step 3: Run cargo test**

```bash
cd src-tauri && cargo test --lib
```

Expected: 14 tests pass (13 + 1 new).

### Task 3.2: TS shell client + context menu store

**Files:**
- Create: `src/lib/shellsClient.ts`
- Create: `src/store/contextMenuStore.ts`
- Create: `src/store/contextMenuStore.test.ts`

- [ ] **Step 1: shellsClient**

```ts
// src/lib/shellsClient.ts
import { invoke } from "@tauri-apps/api/core";
import type { Shell } from "@/types";

export function detectShells(): Promise<Shell[]> {
  return invoke<Shell[]>("detect_shells");
}

export function shellLabel(s: Shell): string {
  switch (s.kind) {
    case "pwsh":
      return "PowerShell 7 (pwsh)";
    case "powershell":
      return "Windows PowerShell (5.1)";
    case "cmd":
      return "Command Prompt (cmd)";
    case "wsl":
      return `WSL · ${s.distro}`;
  }
}
```

- [ ] **Step 2: contextMenuStore test**

```ts
// src/store/contextMenuStore.test.ts
import { describe, expect, it, beforeEach } from "vitest";
import { useContextMenuStore } from "@/store/contextMenuStore";

describe("contextMenuStore", () => {
  beforeEach(() => useContextMenuStore.getState().close());

  it("starts closed", () => {
    expect(useContextMenuStore.getState().open).toBe(false);
  });

  it("openMenu sets position and items", () => {
    useContextMenuStore.getState().openMenu(100, 200, [
      { label: "A", onClick: () => undefined },
      { label: "B", onClick: () => undefined },
    ]);
    const s = useContextMenuStore.getState();
    expect(s.open).toBe(true);
    expect(s.x).toBe(100);
    expect(s.y).toBe(200);
    expect(s.items.length).toBe(2);
  });

  it("close hides", () => {
    useContextMenuStore.getState().openMenu(0, 0, []);
    useContextMenuStore.getState().close();
    expect(useContextMenuStore.getState().open).toBe(false);
  });
});
```

- [ ] **Step 3: contextMenuStore**

```ts
// src/store/contextMenuStore.ts
import { create } from "zustand";
import { devtools } from "zustand/middleware";

export interface ContextMenuItem {
  label: string;
  /** Optional submenu — if set, hovering opens it. */
  submenu?: ContextMenuItem[];
  /** Optional click handler (ignored if submenu is set). */
  onClick?: () => void;
  /** Set to true to render as a separator (label is ignored). */
  separator?: boolean;
}

export interface ContextMenuState {
  open: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
  openMenu: (x: number, y: number, items: ContextMenuItem[]) => void;
  close: () => void;
}

export const useContextMenuStore = create<ContextMenuState>()(
  devtools(
    (set) => ({
      open: false,
      x: 0,
      y: 0,
      items: [],
      openMenu: (x, y, items) => set({ open: true, x, y, items }),
      close: () => set({ open: false, items: [] }),
    }),
    { name: "contextMenuStore" }
  )
);
```

- [ ] **Step 4: Run tests**

```bash
npm test -- --run src/store/contextMenuStore.test.ts
```

Expected: 3 tests pass.

### Task 3.3: ContextMenu component + visual style

**Files:**
- Create: `src/components/ContextMenu.tsx`
- Create: `src/components/ContextMenu.module.css`

- [ ] **Step 1: CSS module**

```css
/* src/components/ContextMenu.module.css */
.menu {
  position: fixed;
  z-index: 1000;
  background: var(--bg-1);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: var(--space-1) 0;
  font-family: var(--font-ui);
  font-size: 13px;
  color: var(--fg-0);
  min-width: 200px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  user-select: none;
}

.item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px var(--space-3);
  cursor: pointer;
  position: relative;
}

.item:hover {
  background: var(--accent-alpha);
}

.item .chev {
  color: var(--fg-2);
  font-size: 10px;
  margin-left: var(--space-2);
}

.separator {
  border-top: 1px solid var(--border);
  margin: var(--space-1) 0;
}

.submenu {
  position: absolute;
  top: 0;
  left: 100%;
}
```

- [ ] **Step 2: Component**

```tsx
// src/components/ContextMenu.tsx — single floating menu bound to contextMenuStore.
import { useEffect, useState } from "react";

import styles from "@/components/ContextMenu.module.css";
import { useContextMenuStore, type ContextMenuItem } from "@/store/contextMenuStore";

export function ContextMenu() {
  const open = useContextMenuStore((s) => s.open);
  const x = useContextMenuStore((s) => s.x);
  const y = useContextMenuStore((s) => s.y);
  const items = useContextMenuStore((s) => s.items);
  const close = useContextMenuStore((s) => s.close);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(`.${styles.menu}`)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onClick, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onClick, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, close]);

  if (!open) return null;
  return <MenuLevel x={x} y={y} items={items} onPick={close} />;
}

function MenuLevel({
  x,
  y,
  items,
  onPick,
}: {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onPick: () => void;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  return (
    <div className={styles.menu} style={{ left: x, top: y }}>
      {items.map((item, idx) => {
        if (item.separator) return <div key={idx} className={styles.separator} />;
        const hasSub = !!item.submenu && item.submenu.length > 0;
        return (
          <div
            key={idx}
            className={styles.item}
            onMouseEnter={() => setHoverIdx(idx)}
            onClick={() => {
              if (!hasSub) {
                item.onClick?.();
                onPick();
              }
            }}
          >
            <span>{item.label}</span>
            {hasSub && <span className={styles.chev}>▸</span>}
            {hasSub && hoverIdx === idx && (
              <div className={styles.submenu}>
                <MenuLevel x={0} y={0} items={item.submenu ?? []} onPick={onPick} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Mount in App.tsx**

Add `import { ContextMenu } from "@/components/ContextMenu";` and render `<ContextMenu />` once at the end of the root div in `App.tsx`. (Single instance — every right-click reuses it.)

### Task 3.4: Per-pane "Change Shell..." submenu wired into TerminalPane

**Files:**
- Modify: `src/components/TerminalPane.tsx`
- Modify: `src/terminals/orchestrator.ts`

- [ ] **Step 1: Detect shells on app start, expose changeShell action**

The existing orchestrator already has an internal `async function spawnPane(paneId, shell)` that does the full PTY open + Channel wiring. Two changes:

1. **Make `spawnPane` exportable.** Change its declaration from `async function spawnPane(...)` to `export async function spawnPane(...)`.

2. **Add a module-level `detectedShells` cache and the `changeShell` action.** At the top of `src/terminals/orchestrator.ts` add:

```ts
import { detectShells } from "@/lib/shellsClient";
import { killPty } from "@/terminals/ptyClient";

let detectedShells: Shell[] = [];

export function getDetectedShells(): Shell[] {
  return detectedShells;
}

export async function changeShell(paneId: PaneId, shell: Shell): Promise<void> {
  // Tear down existing PTY then re-spawn with the new shell. The xterm
  // Terminal stays alive in the registry (so scrollback is preserved
  // through the swap — the new PTY's first bytes append after the old
  // content). Caller is responsible for not interleaving shell swaps
  // for the same paneId.
  await killPty(paneId).catch(() => undefined);
  await spawnPane(paneId, shell);
}
```

3. **Boot-time detection.** Inside `installPtyOrchestrator()` immediately after the existing `useLayoutStore.subscribe(...)` call, add:

```ts
void detectShells()
  .then((shells) => {
    detectedShells = shells;
  })
  .catch((err) => {
    console.error("detectShells failed", err);
  });
```

- [ ] **Step 2: Right-click handler on TerminalPane**

In `src/components/TerminalPane.tsx` add inside the wrapper `<div>`:

```tsx
const onContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
  e.preventDefault();
  e.stopPropagation();
  const shells = getDetectedShells();
  const submenu = shells.map((s) => ({
    label: shellLabel(s),
    onClick: () => void changeShell(paneId, s),
  }));
  useContextMenuStore.getState().openMenu(e.clientX, e.clientY, [
    { label: "Change Shell…", submenu },
  ]);
};
```

Hook it onto the existing `onMouseDown`/wrapper div: `<div onMouseDown={onMouseDown} onContextMenu={onContextMenu} ...>`. Add the missing imports (`getDetectedShells`, `changeShell` from `@/terminals/orchestrator`; `useContextMenuStore`; `shellLabel`).

- [ ] **Step 3: Smoke test**

Run: `npm run tauri dev`
Right-click a terminal pane → context menu with "Change Shell…" → hover → submenu lists PowerShell 7 / Windows PowerShell / Command Prompt / WSL · Ubuntu. Click WSL · Ubuntu → terminal kills + respawns into WSL.

- [ ] **Step 4: Run all tests**

```bash
npm test -- --run
cd src-tauri && cargo test --lib
```

Expected: 79 vitest pass (76 + 3 new), 14 cargo pass.

- [ ] **Step 5: Commit phase 3**

```bash
git add src-tauri/Cargo.toml src-tauri/src/shell_detect.rs src-tauri/src/lib.rs \
        src/lib/shellsClient.ts \
        src/store/contextMenuStore.ts src/store/contextMenuStore.test.ts \
        src/components/ContextMenu.tsx src/components/ContextMenu.module.css \
        src/components/TerminalPane.tsx \
        src/terminals/orchestrator.ts \
        src/App.tsx
git commit -m "feat(shell): auto-detect + per-pane Change Shell context menu"
```

---

## Phase 4 — MD Quick Viewer Panel with CodeMirror 6

Goal: A right-side resizable Panel that can hold one open .md file. Opens via the top-bar icon (added stub), Ctrl+Shift+M, or click on a .md row in Sidebar. Foundation for Phase 5 (link clicks) and Phase 6 (full editor).

### Task 4.1: Install CodeMirror + markdown-it + DOMPurify

- [ ] **Step 1: Install**

```bash
npm install codemirror @codemirror/state @codemirror/view @codemirror/commands @codemirror/lang-markdown @codemirror/language @codemirror/language-data @codemirror/theme-one-dark markdown-it dompurify
npm install -D @types/markdown-it @types/dompurify
```

### Task 4.2: CodeMirror setup factory

**Files:**
- Create: `src/codemirror/theme.ts`
- Create: `src/codemirror/markdownExtensions.ts`
- Create: `src/codemirror/setup.ts`

- [ ] **Step 1: Theme**

```ts
// src/codemirror/theme.ts — minimal dark theme keyed on our CSS tokens.
import { EditorView } from "@codemirror/view";

export const workstationTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: "var(--bg-0)",
      color: "var(--fg-0)",
      height: "100%",
    },
    ".cm-content": {
      caretColor: "var(--accent)",
      fontFamily: "var(--font-ui)",
      fontSize: "15px",
      lineHeight: "1.6",
      padding: "12px 16px",
    },
    ".cm-content[contenteditable='true']": {
      outline: "none",
    },
    ".cm-line": {
      padding: "0",
    },
    ".cm-cursor": {
      borderLeftColor: "var(--accent)",
      borderLeftWidth: "2px",
    },
    "&.cm-focused .cm-selectionBackground, ::selection": {
      backgroundColor: "var(--accent-alpha)",
    },
    ".cm-gutters": {
      backgroundColor: "var(--bg-0)",
      color: "var(--fg-2)",
      border: "none",
      fontFamily: "var(--font-mono)",
      fontSize: "12px",
    },
    ".cm-activeLineGutter, .cm-activeLine": {
      backgroundColor: "var(--bg-1)",
    },
    ".cm-scroller": {
      overflow: "auto",
    },
    // Fenced code blocks render in mono via the markdown language config below.
  },
  { dark: true }
);
```

- [ ] **Step 2: Markdown extensions**

```ts
// src/codemirror/markdownExtensions.ts
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";

export const markdownExtensions = () => [
  markdown({
    base: markdownLanguage,
    codeLanguages: languages,
  }),
];
```

- [ ] **Step 3: Setup factory**

```ts
// src/codemirror/setup.ts — build a CodeMirror EditorView with our defaults.
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";

import { markdownExtensions } from "@/codemirror/markdownExtensions";
import { workstationTheme } from "@/codemirror/theme";

export interface BuildEditorOptions {
  parent: HTMLElement;
  doc: string;
  readOnly?: boolean;
  lineNumbersOn?: boolean;
  onChange?: (doc: string) => void;
}

export function buildEditor(opts: BuildEditorOptions): EditorView {
  const extensions: Extension[] = [
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    ...markdownExtensions(),
    workstationTheme,
    EditorState.readOnly.of(!!opts.readOnly),
  ];
  if (opts.lineNumbersOn) {
    extensions.unshift(lineNumbers());
  }
  if (opts.onChange) {
    extensions.push(
      EditorView.updateListener.of((u) => {
        if (u.docChanged) opts.onChange?.(u.state.doc.toString());
      })
    );
  }
  return new EditorView({
    parent: opts.parent,
    state: EditorState.create({ doc: opts.doc, extensions }),
  });
}
```

### Task 4.3: mdStore slice with Quick Viewer state

**Files:**
- Create: `src/store/mdStore.ts`
- Create: `src/store/mdStore.test.ts`

- [ ] **Step 1: Test**

```ts
// src/store/mdStore.test.ts
import { describe, expect, it, beforeEach, vi } from "vitest";
import { useMdStore } from "@/store/mdStore";

vi.mock("@/lib/fsClient", () => ({
  readTextFile: vi.fn(async (p: string) => `contents of ${p}`),
  writeTextFile: vi.fn(async () => undefined),
}));

describe("mdStore — Quick Viewer", () => {
  beforeEach(() => useMdStore.getState().reset());

  it("starts with quick viewer closed", () => {
    const s = useMdStore.getState();
    expect(s.quickViewer.open).toBe(false);
    expect(s.quickViewer.path).toBeNull();
  });

  it("openMdInQuickViewer loads file contents", async () => {
    await useMdStore.getState().openMdInQuickViewer("/tmp/x.md");
    const s = useMdStore.getState();
    expect(s.quickViewer.open).toBe(true);
    expect(s.quickViewer.path).toBe("/tmp/x.md");
    expect(s.quickViewer.content).toBe("contents of /tmp/x.md");
    expect(s.quickViewer.dirty).toBe(false);
  });

  it("setQuickViewerContent marks dirty", () => {
    useMdStore.getState().setQuickViewerContent("new content");
    expect(useMdStore.getState().quickViewer.content).toBe("new content");
    expect(useMdStore.getState().quickViewer.dirty).toBe(true);
  });

  it("closeQuickViewer resets state", () => {
    useMdStore.getState().setQuickViewerContent("x");
    useMdStore.getState().closeQuickViewer();
    expect(useMdStore.getState().quickViewer.open).toBe(false);
  });
});
```

- [ ] **Step 2: Run test, see fail**

```bash
npm test -- --run src/store/mdStore.test.ts
```

Expected: FAIL — `Cannot find module '@/store/mdStore'`.

- [ ] **Step 3: Write the store**

```ts
// src/store/mdStore.ts
import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

import { readTextFile, writeTextFile } from "@/lib/fsClient";

export interface MdTab {
  id: string;
  path: string;
  content: string;
  dirty: boolean;
}

export interface QuickViewerState {
  open: boolean;
  path: string | null;
  content: string;
  dirty: boolean;
}

export type MdEditorMode = "off" | "full";

export interface MdStoreState {
  mdEditorMode: MdEditorMode;
  tabs: MdTab[];
  activeTabId: string | null;
  quickViewer: QuickViewerState;

  // Quick Viewer
  openMdInQuickViewer: (path: string) => Promise<void>;
  setQuickViewerContent: (content: string) => void;
  saveQuickViewer: () => Promise<void>;
  closeQuickViewer: () => void;

  // MD Editor Full View (used in Phase 6)
  setMdEditorMode: (mode: MdEditorMode) => void;
  openMdTab: (path: string) => Promise<void>;
  setActiveTab: (id: string) => void;
  setTabContent: (id: string, content: string) => void;
  saveMdTab: (id: string) => Promise<void>;
  closeMdTab: (id: string) => void;

  reset: () => void;
}

let _tabSeq = 0;
const nextTabId = () => `mdtab-${++_tabSeq}`;

export const useMdStore = create<MdStoreState>()(
  devtools(
    immer((set, get) => ({
      mdEditorMode: "off",
      tabs: [],
      activeTabId: null,
      quickViewer: { open: false, path: null, content: "", dirty: false },

      openMdInQuickViewer: async (path) => {
        const content = await readTextFile(path);
        set((s) => {
          s.quickViewer = { open: true, path, content, dirty: false };
        });
      },
      setQuickViewerContent: (content) => {
        set((s) => {
          s.quickViewer.content = content;
          s.quickViewer.dirty = true;
        });
      },
      saveQuickViewer: async () => {
        const qv = get().quickViewer;
        if (qv.path === null) return;
        await writeTextFile(qv.path, qv.content);
        set((s) => {
          s.quickViewer.dirty = false;
        });
      },
      closeQuickViewer: () => {
        set((s) => {
          s.quickViewer = { open: false, path: null, content: "", dirty: false };
        });
      },

      setMdEditorMode: (mode) => set((s) => { s.mdEditorMode = mode; }),
      openMdTab: async (path) => {
        const existing = get().tabs.find((t) => t.path === path);
        if (existing) {
          set((s) => { s.activeTabId = existing.id; s.mdEditorMode = "full"; });
          return;
        }
        const content = await readTextFile(path);
        const id = nextTabId();
        set((s) => {
          s.tabs.push({ id, path, content, dirty: false });
          s.activeTabId = id;
          s.mdEditorMode = "full";
        });
      },
      setActiveTab: (id) => set((s) => { s.activeTabId = id; }),
      setTabContent: (id, content) =>
        set((s) => {
          const t = s.tabs.find((t) => t.id === id);
          if (t) { t.content = content; t.dirty = true; }
        }),
      saveMdTab: async (id) => {
        const t = get().tabs.find((t) => t.id === id);
        if (!t) return;
        await writeTextFile(t.path, t.content);
        set((s) => {
          const tt = s.tabs.find((t) => t.id === id);
          if (tt) tt.dirty = false;
        });
      },
      closeMdTab: (id) =>
        set((s) => {
          const idx = s.tabs.findIndex((t) => t.id === id);
          if (idx === -1) return;
          s.tabs.splice(idx, 1);
          if (s.activeTabId === id) {
            s.activeTabId = s.tabs.length === 0 ? null : s.tabs[Math.min(idx, s.tabs.length - 1)].id;
          }
          if (s.tabs.length === 0) s.mdEditorMode = "off";
        }),

      reset: () =>
        set((s) => {
          s.mdEditorMode = "off";
          s.tabs = [];
          s.activeTabId = null;
          s.quickViewer = { open: false, path: null, content: "", dirty: false };
        }),
    })),
    { name: "mdStore" }
  )
);
```

- [ ] **Step 4: Run tests**

```bash
npm test -- --run src/store/mdStore.test.ts
```

Expected: 4 tests pass.

### Task 4.4: QuickViewer component (CodeMirror 6 bound to mdStore)

**Files:**
- Create: `src/components/QuickViewer.tsx`
- Create: `src/components/QuickViewer.module.css`

- [ ] **Step 1: CSS module**

```css
/* src/components/QuickViewer.module.css */
.root {
  height: 100%;
  background: var(--bg-0);
  border-left: 1px solid var(--border);
  display: flex;
  flex-direction: column;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--border);
  font-family: var(--font-ui);
  font-size: 12px;
  color: var(--fg-1);
}

.title {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.dirty {
  color: var(--accent);
  margin-right: var(--space-1);
}

.close {
  background: transparent;
  color: var(--fg-1);
  border: none;
  cursor: pointer;
  font-size: 14px;
  padding: 0 var(--space-1);
}
.close:hover { color: var(--fg-0); }

.editor {
  flex: 1;
  min-height: 0;
}
```

- [ ] **Step 2: Component**

```tsx
// src/components/QuickViewer.tsx
import { useEffect, useRef } from "react";

import styles from "@/components/QuickViewer.module.css";
import { buildEditor } from "@/codemirror/setup";
import { useMdStore } from "@/store/mdStore";
import type { EditorView } from "@codemirror/view";

export function QuickViewer() {
  const path = useMdStore((s) => s.quickViewer.path);
  const content = useMdStore((s) => s.quickViewer.content);
  const dirty = useMdStore((s) => s.quickViewer.dirty);
  const setContent = useMdStore((s) => s.setQuickViewerContent);
  const save = useMdStore((s) => s.saveQuickViewer);
  const close = useMdStore((s) => s.closeQuickViewer);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);

  // Build the editor once per Quick Viewer open. When `path` changes, dispose
  // and rebuild — simplest correct path; CM doesn't need to be reused across
  // files.
  useEffect(() => {
    if (!hostRef.current || path === null) return;
    const view = buildEditor({
      parent: hostRef.current,
      doc: content,
      onChange: (doc) => setContent(doc),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [path]); // intentionally not depending on content — store updates don't rebuild

  // Ctrl+S to save when QuickViewer has focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && (e.key === "s" || e.key === "S")) {
        const active = document.activeElement;
        if (hostRef.current && active && hostRef.current.contains(active)) {
          e.preventDefault();
          void save();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [save]);

  if (path === null) return null;
  const fileName = path.split(/[/\\]/).pop() ?? path;

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.title}>
          {dirty && <span className={styles.dirty}>●</span>}
          {fileName}
        </span>
        <button className={styles.close} title="Close" onClick={close}>
          ✕
        </button>
      </div>
      <div className={styles.editor} ref={hostRef} />
    </div>
  );
}
```

### Task 4.5: Mount Quick Viewer as a right Panel in App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add Quick Viewer between Tiling Area and right edge**

Replace the inner `<div style={{ flex: 1, position: "relative", padding: 1 }}>...</div>` with a horizontal `PanelGroup` so the Tiling Area + Quick Viewer share width, with a resizable splitter between them.

```tsx
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import { QuickViewer } from "@/components/QuickViewer";
// ...
const quickViewerOpen = useMdStore((s) => s.quickViewer.open);
```

```tsx
<div style={{ flex: 1, minWidth: 0, position: "relative" }}>
  <PanelGroup direction="horizontal" id="pg-root-h">
    <Panel defaultSize={quickViewerOpen ? 75 : 100} minSize={40}>
      {root === null ? (
        <div style={{ color: "var(--fg-2)", display: "flex", alignItems: "center", justifyContent: "center", height: "100%" }}>
          empty layout
        </div>
      ) : (
        <PaneTree node={root} path="root" />
      )}
    </Panel>
    {quickViewerOpen && (
      <>
        <PanelResizeHandle style={{ width: 3, background: "var(--border)", cursor: "col-resize" }} />
        <Panel defaultSize={25} minSize={20} maxSize={60}>
          <QuickViewer />
        </Panel>
      </>
    )}
  </PanelGroup>
</div>
```

- [ ] **Step 2: Add Ctrl+Shift+M to toggle quick viewer in useKeyboardShortcuts**

In `src/hooks/useKeyboardShortcuts.ts`, in the keydown handler, before the existing `Ctrl+W close` branch, add:

```ts
if (e.ctrlKey && e.shiftKey && (e.key === "M" || e.key === "m")) {
  e.preventDefault();
  const qv = useMdStore.getState().quickViewer;
  if (qv.open) {
    useMdStore.getState().closeQuickViewer();
  } else {
    // Reopen the last file if one was previously loaded; otherwise no-op.
    if (qv.path !== null) void useMdStore.getState().openMdInQuickViewer(qv.path);
  }
  return;
}
```

- [ ] **Step 3: Smoke test**

Run: `npm run tauri dev`
Click an `.md` file in the Sidebar → Quick Viewer opens on the right with the file contents in CodeMirror.
Type → ● appears next to filename.
Press Ctrl+S → ● disappears, file is written to disk (verify by `Get-Content` in a terminal pane).
Click ✕ → Quick Viewer closes.
Press Ctrl+Shift+M with no previously opened file → no-op (subtle; v0.2 will spawn a placeholder).

### Task 4.6: Wire Sidebar .md click + New File into mdStore

Phase 2 left these as deferred no-ops. Now that mdStore exists, wire them.

**Files:**
- Modify: `src/components/SidebarTree.tsx`
- Modify: `src/components/Sidebar.tsx`

- [ ] **Step 1: SidebarTree — call openMdInQuickViewer on .md click**

Re-add the `useMdStore` import and the click handler:

```tsx
import { useMdStore } from "@/store/mdStore";
// ...
const openMdInQuickViewer = useMdStore((s) => s.openMdInQuickViewer);
// ...
const onClick = () => {
  if (entry.is_dir) {
    toggleExpanded(entry.path);
  } else if (entry.name.endsWith(".md")) {
    void openMdInQuickViewer(entry.path).catch((err) => {
      console.error("openMdInQuickViewer failed", err);
    });
  }
};
```

- [ ] **Step 2: Sidebar — call openMdTab after writeTextFile on New File**

In `Sidebar.tsx`, re-add the `useMdStore` import:

```tsx
import { useMdStore } from "@/store/mdStore";
// ...
const openMdTab = useMdStore((s) => s.openMdTab);
// ...
const onNewFile = async () => {
  if (workspaceFolder === null) return;
  const name = window.prompt("New file name (relative to workspace)");
  if (!name) return;
  const path = `${workspaceFolder}/${name.endsWith(".md") ? name : `${name}.md`}`;
  try {
    await writeTextFile(path, "");
    await openMdTab(path); // opens the new file in MD Editor Full View (CONTEXT.md Sidebar header definition)
  } catch (e) {
    console.error("new file failed", e);
  }
};
```

- [ ] **Step 3: Smoke test**

Click any `.md` file in Sidebar → Quick Viewer opens with that file.
Click ＋ → enter `scratch` → file is created at `<home>/scratch.md` and a new MD Editor tab opens with it (MD Editor mode auto-flips to "full" because openMdTab does that).

- [ ] **Step 4: Run all tests**

```bash
npm test -- --run
```

Expected: 83 vitest pass (79 + 4 new).

- [ ] **Step 5: Commit phase 4**

```bash
git add package.json package-lock.json \
        src/codemirror/setup.ts src/codemirror/theme.ts src/codemirror/markdownExtensions.ts \
        src/store/mdStore.ts src/store/mdStore.test.ts \
        src/components/QuickViewer.tsx src/components/QuickViewer.module.css \
        src/components/Sidebar.tsx src/components/SidebarTree.tsx \
        src/hooks/useKeyboardShortcuts.ts \
        src/App.tsx
git commit -m "feat(md): Quick Viewer Panel with CodeMirror 6"
```

---

## Phase 5 — Ctrl+Click MD Link in terminals opens Quick Viewer

Goal: When a Terminal Pane prints something like `./docs/plan.md` or `C:\path\file.md`, Ctrl+Click that text → it opens in the MD Quick Viewer.

### Task 5.1: MD Link regex + path resolution

**Files:**
- Create: `src/terminals/mdLinkProvider.ts`
- Create: `src/terminals/mdLinkProvider.test.ts`

- [ ] **Step 1: Test**

```ts
// src/terminals/mdLinkProvider.test.ts
import { describe, expect, it } from "vitest";
import { findMdLinks, resolveMdPath } from "@/terminals/mdLinkProvider";

describe("findMdLinks", () => {
  it("finds a relative .md path in a line", () => {
    const line = "see ./docs/plan.md for details";
    const matches = findMdLinks(line);
    expect(matches.length).toBe(1);
    expect(matches[0].text).toBe("./docs/plan.md");
    expect(matches[0].start).toBe(4);
    expect(matches[0].end).toBe(18);
  });

  it("finds a windows absolute .md path", () => {
    const line = 'open "C:\\Users\\posan\\notes.md" now';
    const matches = findMdLinks(line);
    expect(matches.length).toBe(1);
    expect(matches[0].text).toBe("C:\\Users\\posan\\notes.md");
  });

  it("finds multiple matches", () => {
    const line = "a.md and ./b.md";
    expect(findMdLinks(line).length).toBe(2);
  });

  it("ignores non-md paths", () => {
    expect(findMdLinks("./foo.txt").length).toBe(0);
  });
});

describe("resolveMdPath", () => {
  it("returns absolute path unchanged", () => {
    expect(resolveMdPath("C:\\x\\y.md", "C:\\cwd")).toBe("C:\\x\\y.md");
  });

  it("joins relative path with cwd using OS separator on Windows", () => {
    // resolveMdPath uses simple string join — the Rust side canonicalises.
    expect(resolveMdPath("./a.md", "C:\\cwd")).toBe("C:\\cwd/./a.md");
  });

  it("returns null when cwd is null", () => {
    expect(resolveMdPath("./a.md", null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test, see fail**

```bash
npm test -- --run src/terminals/mdLinkProvider.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the module**

```ts
// src/terminals/mdLinkProvider.ts
// Detects .md file references in terminal output and exposes a click
// handler for xterm.js's registerLinkProvider.

import type { IDisposable, ILink, ILinkProvider, Terminal } from "@xterm/xterm";

import { useMdStore } from "@/store/mdStore";
import { usePtyStore } from "@/store/ptyStore";
import type { PaneId } from "@/types";

const MD_LINK_REGEX =
  /(?:[A-Za-z]:[\\/][^\s"'`<>]+\.md|\.{1,2}[\\/][^\s"'`<>]+\.md|[A-Za-z0-9_.\-/\\]+\.md)/g;

export interface MdLinkMatch {
  text: string;
  start: number;
  end: number;
}

export function findMdLinks(line: string): MdLinkMatch[] {
  const out: MdLinkMatch[] = [];
  for (const m of line.matchAll(MD_LINK_REGEX)) {
    if (m.index === undefined) continue;
    out.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }
  return out;
}

export function isAbsolute(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("/");
}

export function resolveMdPath(path: string, cwd: string | null): string | null {
  if (isAbsolute(path)) return path;
  if (cwd === null) return null;
  return `${cwd}/${path}`;
}

export function buildMdLinkProvider(
  term: Terminal,
  paneId: PaneId
): ILinkProvider {
  return {
    provideLinks(bufferLineNumber: number, callback: (links: ILink[] | undefined) => void): void {
      const buf = term.buffer.active;
      const line = buf.getLine(bufferLineNumber - 1);
      if (!line) return callback(undefined);
      const text = line.translateToString();
      const matches = findMdLinks(text);
      if (matches.length === 0) return callback(undefined);
      const links: ILink[] = matches.map((m) => ({
        range: {
          start: { x: m.start + 1, y: bufferLineNumber },
          end: { x: m.end, y: bufferLineNumber },
        },
        text: m.text,
        activate: (_event, t) => {
          const meta = usePtyStore.getState().panes.get(paneId);
          const resolved = resolveMdPath(t, meta?.cwd ?? null);
          if (resolved !== null) {
            void useMdStore.getState().openMdInQuickViewer(resolved);
          }
        },
      }));
      callback(links);
    },
  } as ILinkProvider;
}

export function registerMdLinkProvider(term: Terminal, paneId: PaneId): IDisposable {
  return term.registerLinkProvider(buildMdLinkProvider(term, paneId));
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- --run src/terminals/mdLinkProvider.test.ts
```

Expected: 7 tests pass.

### Task 5.2: Hook the link provider into registry.ts

**Files:**
- Modify: `src/terminals/registry.ts`

- [ ] **Step 1: After `term.open(host)` (the first-ever path), call registerMdLinkProvider**

In `src/terminals/registry.ts` find the `term.open(host)` line, then immediately after add:

```ts
const linkDisposable = registerMdLinkProvider(term, paneId);
entry.linkDisposable = linkDisposable;
```

Update the TerminalEntry interface to include `linkDisposable: IDisposable | null`. In `disposeTerminal`, call `entry.linkDisposable?.dispose()` before `entry.term.dispose()`.

Add `import { registerMdLinkProvider } from "@/terminals/mdLinkProvider";` at the top.

- [ ] **Step 2: Smoke test**

Run: `npm run tauri dev`
In a terminal: `Get-ChildItem *.md` (or `ls *.md` in WSL) — output should show .md filenames.
Hover one → the text becomes underlined.
Ctrl+Click → Quick Viewer opens with that file.

Note: PTY-side `cwd` tracking is the v0.2 OSC-7 work; for v0.1 the resolve falls back to whatever `usePtyStore.getState().panes.get(paneId).cwd` returned at spawn (most likely `null`). That means absolute paths Ctrl-click reliably, relative paths may not until OSC 7 lands. Test with `Get-Location` then absolute paths printed by the shell.

- [ ] **Step 3: Run all tests**

```bash
npm test -- --run
```

Expected: 90 pass (83 + 7 new).

- [ ] **Step 4: Commit phase 5**

```bash
git add src/terminals/mdLinkProvider.ts src/terminals/mdLinkProvider.test.ts src/terminals/registry.ts
git commit -m "feat(terminal): Ctrl+Click MD Link opens Quick Viewer"
```

---

## Phase 6 — MD Editor Full View with Tab Strip + Live Preview pane

Goal: Ctrl+E switches the central area from Tiling Area to MD Editor mode. Multiple .md files open via tabs at the top. Each tab has its own CodeMirror instance plus a live HTML preview pane to the right, sync-scrolled.

### Task 6.1: renderMarkdown — markdown-it + DOMPurify pure function

**Files:**
- Create: `src/preview/renderMarkdown.ts`
- Create: `src/preview/renderMarkdown.test.ts`

- [ ] **Step 1: Test**

```ts
// src/preview/renderMarkdown.test.ts
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "@/preview/renderMarkdown";

describe("renderMarkdown", () => {
  it("renders headings", () => {
    expect(renderMarkdown("# Hello")).toContain("<h1>Hello</h1>");
  });

  it("does not render raw HTML (XSS guard)", () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\n# After');
    expect(html).not.toContain("<script>");
    expect(html).toContain("<h1>After</h1>");
  });

  it("linkifies URLs", () => {
    expect(renderMarkdown("see https://example.com here")).toContain("<a");
  });

  it("renders fenced code as <pre><code>", () => {
    const html = renderMarkdown("```ts\nlet x = 1\n```");
    expect(html).toMatch(/<pre><code/);
  });
});
```

- [ ] **Step 2: Run test, see fail**

```bash
npm test -- --run src/preview/renderMarkdown.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the renderer**

```ts
// src/preview/renderMarkdown.ts
// DESIGN.md §4: markdown-it locked to { html: false, linkify: true, breaks: true }
// because the Preview Pane renders inside the Tauri webview which has Tauri
// command access — embedded HTML would be an XSS vector. DOMPurify runs as
// defence-in-depth before injection.

import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";

const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

export function renderMarkdown(src: string): string {
  const rawHtml = md.render(src);
  return DOMPurify.sanitize(rawHtml, { USE_PROFILES: { html: true } });
}
```

- [ ] **Step 4: Run tests**

```bash
npm test -- --run src/preview/renderMarkdown.test.ts
```

Expected: 4 tests pass.

### Task 6.2: MdEditorPreview component

**Files:**
- Create: `src/components/MdEditorPreview.tsx`
- Create: `src/components/MdEditorPreview.module.css`

- [ ] **Step 1: CSS — Amber-on-Black markdown styling**

```css
/* src/components/MdEditorPreview.module.css */
.root {
  height: 100%;
  overflow-y: auto;
  background: var(--bg-0);
  color: var(--fg-0);
  font-family: var(--font-ui);
  font-size: 15px;
  line-height: 1.6;
  padding: var(--space-4);
}
.root h1, .root h2, .root h3, .root h4, .root h5, .root h6 {
  color: var(--fg-heading);
  font-weight: 600;
  margin-top: 1.4em;
  margin-bottom: 0.5em;
  line-height: 1.25;
}
.root h1 { font-size: 1.8em; border-bottom: 1px solid var(--border); padding-bottom: 0.2em; }
.root h2 { font-size: 1.4em; }
.root h3 { font-size: 1.15em; }
.root p { margin: 0.5em 0; }
.root a { color: var(--accent); text-decoration: none; }
.root a:hover { text-decoration: underline; }
.root code {
  font-family: var(--font-mono);
  font-size: 0.9em;
  background: var(--bg-2);
  padding: 1px 4px;
  border-radius: var(--radius-sm);
}
.root pre {
  background: var(--bg-2);
  padding: var(--space-3);
  border-radius: var(--radius-md);
  overflow-x: auto;
  margin: 0.8em 0;
}
.root pre code {
  background: transparent;
  padding: 0;
  font-size: 13px;
  line-height: 1.5;
}
.root blockquote {
  border-left: 3px solid var(--accent-dim);
  margin: 0.8em 0;
  padding: 0.4em 0 0.4em var(--space-3);
  color: var(--fg-1);
}
.root ul, .root ol { padding-left: 1.6em; }
.root li { margin: 0.3em 0; }
.root table {
  border-collapse: collapse;
  margin: 0.8em 0;
}
.root th, .root td {
  border: 1px solid var(--border);
  padding: 6px 10px;
}
.root th { background: var(--bg-1); }
.root hr { border: none; border-top: 1px solid var(--border); margin: 1.2em 0; }
```

- [ ] **Step 2: Component**

```tsx
// src/components/MdEditorPreview.tsx
import { useEffect, useMemo, useRef, useState } from "react";

import styles from "@/components/MdEditorPreview.module.css";
import { renderMarkdown } from "@/preview/renderMarkdown";

interface Props {
  source: string;
  /** Imperative ref to the inner scroll container, exposed for scroll-sync. */
  containerRef?: React.MutableRefObject<HTMLDivElement | null>;
}

export function MdEditorPreview({ source, containerRef }: Props) {
  // Debounce the render to ~250ms after the last edit (DESIGN.md §4 rule).
  const [renderedSrc, setRenderedSrc] = useState(source);
  useEffect(() => {
    const t = window.setTimeout(() => setRenderedSrc(source), 250);
    return () => window.clearTimeout(t);
  }, [source]);
  const html = useMemo(() => renderMarkdown(renderedSrc), [renderedSrc]);
  const innerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (containerRef) containerRef.current = innerRef.current;
  });
  return <div className={styles.root} ref={innerRef} dangerouslySetInnerHTML={{ __html: html }} />;
}
```

### Task 6.3: MdEditorTabStrip component

**Files:**
- Create: `src/components/MdEditorTabStrip.tsx`
- Create: `src/components/MdEditorTabStrip.module.css`

- [ ] **Step 1: CSS**

```css
/* src/components/MdEditorTabStrip.module.css */
.strip {
  display: flex;
  flex-direction: row;
  align-items: center;
  background: var(--bg-1);
  border-bottom: 1px solid var(--border);
  height: 32px;
  overflow-x: auto;
  font-family: var(--font-ui);
  font-size: 13px;
}
.tab {
  display: flex;
  align-items: center;
  padding: 0 var(--space-3);
  height: 100%;
  min-width: 80px;
  max-width: 200px;
  color: var(--fg-1);
  background: var(--bg-2);
  border-right: 1px solid var(--border);
  cursor: pointer;
  position: relative;
}
.tab:hover { color: var(--fg-0); }
.tab.active {
  color: var(--fg-0);
  background: var(--bg-0);
  border-top: 2px solid var(--accent);
  /* offset for the 2px border so the label doesn't shift */
  margin-top: -2px;
  height: calc(100% + 2px);
}
.label {
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.dirty {
  color: var(--accent);
  margin-right: var(--space-1);
}
.close {
  margin-left: var(--space-2);
  color: var(--fg-2);
  background: transparent;
  border: none;
  cursor: pointer;
  visibility: hidden;
  font-size: 12px;
  padding: 2px;
}
.tab.active .close, .tab:hover .close { visibility: visible; }
.close:hover { color: var(--fg-0); }
```

- [ ] **Step 2: Component**

```tsx
// src/components/MdEditorTabStrip.tsx
import styles from "@/components/MdEditorTabStrip.module.css";
import { useMdStore } from "@/store/mdStore";

export function MdEditorTabStrip() {
  const tabs = useMdStore((s) => s.tabs);
  const activeTabId = useMdStore((s) => s.activeTabId);
  const setActiveTab = useMdStore((s) => s.setActiveTab);
  const closeMdTab = useMdStore((s) => s.closeMdTab);
  return (
    <div className={styles.strip}>
      {tabs.map((t) => {
        const fileName = t.path.split(/[/\\]/).pop() ?? t.path;
        const isActive = t.id === activeTabId;
        return (
          <div
            key={t.id}
            className={`${styles.tab} ${isActive ? styles.active : ""}`}
            onClick={() => setActiveTab(t.id)}
          >
            <span className={styles.label}>
              {t.dirty && <span className={styles.dirty}>●</span>}
              {fileName}
            </span>
            <button
              className={styles.close}
              title="Close tab"
              onClick={(e) => {
                e.stopPropagation();
                closeMdTab(t.id);
              }}
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
```

### Task 6.4: MdEditor root with editor pane + preview pane + scroll sync

**Files:**
- Create: `src/components/MdEditor.tsx`
- Create: `src/components/MdEditor.module.css`

- [ ] **Step 1: CSS**

```css
/* src/components/MdEditor.module.css */
.root {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-0);
}
.body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: row;
}
.editor {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  border-right: 1px solid var(--border);
}
.cm {
  flex: 1;
  min-height: 0;
}
.preview {
  flex: 1;
  min-width: 0;
}
.empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--fg-2);
  font-family: var(--font-ui);
  font-size: 13px;
}
```

- [ ] **Step 2: Component**

```tsx
// src/components/MdEditor.tsx
import { useEffect, useRef } from "react";

import styles from "@/components/MdEditor.module.css";
import { buildEditor } from "@/codemirror/setup";
import { MdEditorPreview } from "@/components/MdEditorPreview";
import { MdEditorTabStrip } from "@/components/MdEditorTabStrip";
import { useMdStore } from "@/store/mdStore";
import type { EditorView } from "@codemirror/view";

export function MdEditor() {
  const activeTabId = useMdStore((s) => s.activeTabId);
  const tab = useMdStore((s) => s.tabs.find((t) => t.id === activeTabId) ?? null);
  const setTabContent = useMdStore((s) => s.setTabContent);

  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const previewScrollRef = useRef<HTMLDivElement | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);

  // Build / rebuild editor when active tab changes.
  useEffect(() => {
    if (!editorHostRef.current || tab === null) return;
    const view = buildEditor({
      parent: editorHostRef.current,
      doc: tab.content,
      lineNumbersOn: true,
      onChange: (doc) => setTabContent(tab.id, doc),
    });
    editorViewRef.current = view;
    return () => {
      view.destroy();
      editorViewRef.current = null;
    };
  }, [tab?.id]);

  // Scroll sync: editor → preview via percentage. rAF-coalesced.
  useEffect(() => {
    const view = editorViewRef.current;
    if (!view || !previewScrollRef.current) return;
    let raf: number | null = null;
    const handler = () => {
      if (raf !== null) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        const scroller = view.scrollDOM;
        const previewEl = previewScrollRef.current;
        if (!previewEl) return;
        const pct = scroller.scrollTop / Math.max(1, scroller.scrollHeight - scroller.clientHeight);
        previewEl.scrollTop = pct * Math.max(0, previewEl.scrollHeight - previewEl.clientHeight);
      });
    };
    view.scrollDOM.addEventListener("scroll", handler, { passive: true });
    return () => {
      view.scrollDOM.removeEventListener("scroll", handler);
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [tab?.id]);

  return (
    <div className={styles.root}>
      <MdEditorTabStrip />
      <div className={styles.body}>
        {tab === null ? (
          <div className={styles.empty}>No file open · Ctrl+O to open</div>
        ) : (
          <>
            <div className={styles.editor}>
              <div className={styles.cm} ref={editorHostRef} />
            </div>
            <div className={styles.preview}>
              <MdEditorPreview source={tab.content} containerRef={previewScrollRef} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

### Task 6.5: Wire Ctrl+E / Ctrl+O / Ctrl+S / Ctrl+W / Ctrl+Tab + render MdEditor when mode==="full"

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/hooks/useKeyboardShortcuts.ts`

- [ ] **Step 1: App.tsx — swap Tiling Area for MdEditor when mode is full**

In `App.tsx` add:

```ts
const mdMode = useMdStore((s) => s.mdEditorMode);
```

Replace the inner Panel that hosts `PaneTree` with:

```tsx
{mdMode === "full" ? <MdEditor /> : (root === null ? <div className={styles.empty}>empty layout</div> : <PaneTree node={root} path="root" />)}
```

Add `import { MdEditor } from "@/components/MdEditor";`.

- [ ] **Step 2: Keyboard shortcuts**

In `src/hooks/useKeyboardShortcuts.ts`, add these branches in the keydown handler (order them BEFORE the existing pane shortcuts so MD Editor gets first dibs when active):

```ts
// Ctrl+E — toggle MD Editor mode
if (e.ctrlKey && !e.shiftKey && (e.key === "e" || e.key === "E")) {
  e.preventDefault();
  const cur = useMdStore.getState().mdEditorMode;
  useMdStore.getState().setMdEditorMode(cur === "full" ? "off" : "full");
  return;
}

// Ctrl+O — open .md file (only meaningful in MD Editor mode but accept anywhere)
if (e.ctrlKey && !e.shiftKey && (e.key === "o" || e.key === "O")) {
  e.preventDefault();
  void (async () => {
    // Use window.prompt for v0.1 — Tauri's dialog plugin is a v0.2 polish (DESIGN.md §3 MD Editor entry).
    const path = window.prompt("Open .md file (absolute path)");
    if (path && path.trim().length > 0) {
      await useMdStore.getState().openMdTab(path.trim()).catch((err) => {
        console.error("openMdTab failed", err);
      });
    }
  })();
  return;
}

// Ctrl+S — save active tab (when MD editor is focused)
if (e.ctrlKey && !e.shiftKey && (e.key === "s" || e.key === "S")) {
  if (useMdStore.getState().mdEditorMode === "full") {
    const active = useMdStore.getState().activeTabId;
    if (active !== null) {
      e.preventDefault();
      void useMdStore.getState().saveMdTab(active);
      return;
    }
  }
}

// Ctrl+W — when in MD mode, close active tab instead of closing pane
if (e.ctrlKey && !e.shiftKey && (e.key === "w" || e.key === "W")) {
  if (useMdStore.getState().mdEditorMode === "full") {
    const active = useMdStore.getState().activeTabId;
    if (active !== null) {
      e.preventDefault();
      useMdStore.getState().closeMdTab(active);
      return;
    }
  }
}

// Ctrl+Tab — cycle MD tabs
if (e.ctrlKey && !e.shiftKey && e.key === "Tab") {
  if (useMdStore.getState().mdEditorMode === "full") {
    e.preventDefault();
    const { tabs, activeTabId, setActiveTab } = useMdStore.getState();
    if (tabs.length === 0) return;
    const idx = tabs.findIndex((t) => t.id === activeTabId);
    const next = tabs[(idx + 1) % tabs.length];
    setActiveTab(next.id);
    return;
  }
}
```

- [ ] **Step 3: Smoke test**

Run: `npm run tauri dev`
- Press Ctrl+E → central area swaps from terminals to MD Editor. Empty state says "No file open · Ctrl+O to open".
- Press Ctrl+O → prompt. Type the absolute path of a real `.md` (e.g. `C:\Users\posan\OneDrive\Desktop\WORFLOW\DESIGN.md`).
- Editor loads on the left, preview on the right. Type in editor → preview re-renders ~250ms later. Dirty dot appears on tab.
- Ctrl+S → file written, dirty dot disappears.
- Open a second file via Ctrl+O → new tab appears, becomes active.
- Ctrl+Tab cycles between tabs.
- Ctrl+W closes the active tab.
- Close last tab → MD Editor mode auto-flips to off, central area returns to terminals.
- Click a `.md` row in Sidebar while in MD mode → opens as a tab (since `openMdInQuickViewer` is what Sidebar uses — change that branch in `SidebarTree.tsx` to call `openMdTab` when MD editor mode is `full`, else `openMdInQuickViewer`).

Actually the spec is clearer: Sidebar click always uses Quick Viewer. Full View tabs only come via Ctrl+O. Keep SidebarTree as-is.

- [ ] **Step 4: Run all tests**

```bash
npm test -- --run
cd src-tauri && cargo test --lib && cargo clippy --all-targets -- -D warnings && cargo fmt --all -- --check
```

Expected: 94 vitest pass (90 + 4 new), 14 cargo pass, lint clean.

- [ ] **Step 5: Commit phase 6**

```bash
git add src/preview/renderMarkdown.ts src/preview/renderMarkdown.test.ts \
        src/components/MdEditor.tsx src/components/MdEditor.module.css \
        src/components/MdEditorPreview.tsx src/components/MdEditorPreview.module.css \
        src/components/MdEditorTabStrip.tsx src/components/MdEditorTabStrip.module.css \
        src/App.tsx src/hooks/useKeyboardShortcuts.ts
git commit -m "feat(md): MD Editor Full View with tabs + live preview pane"
```

---

## Self-review checklist (run after every phase, not just at the end)

After landing each phase commit:

1. **Spec coverage:** open DESIGN.md §12 W3, find the sub-item this phase covers, verify it's actually done end-to-end (visible in the app, not just code that exists).
2. **No hard-coded colours leaked in.** `grep -RE "#[0-9a-fA-F]{6}" src/` should return only `theme.css` (and CodeMirror's internal styling, which is unavoidable).
3. **No `any` / `unknown` casts added.** `npm run typecheck` clean.
4. **No new clippy warnings.** `cargo clippy --all-targets -- -D warnings` clean.
5. **Tests pass.** Vitest + cargo green at the counts listed in the commit step.
6. **The app launches and the new surface visibly works.** Don't ship a commit you haven't smoke-tested.

---

## Phase ordering rationale (for the reader who's about to execute this)

Why this order:

1. **Theme + fonts first** — these are foundation. Every later phase reaches for `var(--bg-0)` or `var(--font-ui)`. Skipping them means later phases hard-code colours that have to be ripped out.
2. **Sidebar before MD work** — Sidebar's click → Quick Viewer is a natural exit point. By Phase 2 you can already click .md files in the tree (the Quick Viewer just doesn't exist yet — call gets stored in the mdStore action that you build in Phase 4 which loads the file but the panel is mounted at that point).
3. **Shell menu before MD work** — Pure terminal UX; lets you swap to WSL for testing if you want. Independent surface.
4. **Quick Viewer before MD Link** — Phase 5 (Ctrl+Click) is the smallest possible payload once Quick Viewer exists. If we did Link first it would have nowhere to deliver to.
5. **Full Editor last** — Builds on the CodeMirror infrastructure from Phase 4. Largest phase by code volume, lowest risk because every dependency it needs is already proven to work.

If you stop after any phase, the app remains in a working state — no half-broken UI surfaces.
