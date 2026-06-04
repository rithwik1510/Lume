# v0.1 Finishing Touches — UI promises DESIGN.md made that the weekends shipped without

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the gap between what DESIGN.md says v0.1 ships and what the Weekend 0-4 commits actually deliver. Five user-visible items the spec promised but the weekend arc deferred or stubbed. After this plan: the product matches the v0.1 spec end-to-end and `Weekend 5 (Tests + CI + MSI)` can finally run against a complete surface.

**Architecture:** Three sequenced phases, each ending in a clean bundle commit and a holistic phase review. Phase 1 lands the toast notification system (DESIGN.md §8) — needed first because every subsequent phase wants somewhere to surface errors/warnings/success. Phase 2 lands two dialog-shaped surfaces that share modal/IPC infrastructure: the active-process confirm dialog on pane close (DESIGN.md §1 invariant 3) and the Open Folder workspace-change UI (DESIGN.md §3 + CONTEXT.md). Phase 3 lands two top-bar popup surfaces: the ⊞ Split menu popup with → ↑ ↓ (DESIGN.md §3) and the ⌨ Keyboard shortcuts viewer modal (DESIGN.md §7).

**Tech Stack:**
- Frontend: existing React 18 + Vite + TypeScript + Zustand. New store: `toastStore.ts`. New Tauri plugin: `@tauri-apps/plugin-dialog` (for the Open Folder OS file picker — replaces `window.prompt`).
- Backend: no new Rust crates. Existing `dirs`, `notify`, `portable-pty` already cover what we need. One new Tauri command: `is_pty_busy` (heuristic for "this PTY has a running foreground process — confirm before close").

**Acceptance for the plan as a whole:**
- A "save failed" / "config invalid" / "file modified externally" event surfaces as a visible toast in the bottom-right per DESIGN.md §8.
- Clicking the × on a pane that has a running child process shows a confirm dialog before the PTY dies. Clicking × on an idle-shell pane is silent (matches CONTEXT.md invariant 3).
- A new ⓘ "Open Folder" affordance on the titlebar (or via Ctrl+K Ctrl+O) opens an OS folder picker. Picking a folder updates `sidebarStore.workspaceFolder`, the sidebar reroots, the file watcher follows. Existing terminals are NOT auto-cd'd (per CONTEXT.md).
- Clicking the ⊞ button in the titlebar opens a small popup with three split direction icons (→ ↑ ↓). Each closes the popup and splits the focused pane.
- Clicking the ⌨ button (or pressing Ctrl+?) opens a modal listing every keyboard shortcut from DESIGN.md §7, grouped by category, read-only.
- All five verification gates green at each phase boundary: `npm test -- --run`, `npm run typecheck`, `cargo test --lib`, `cargo clippy --all-targets -- -D warnings`, `cargo fmt --all -- --check`.

**Phase commits (target):**
- 32: `feat(toast): notification surface per DESIGN.md §8`
- 33: `feat(panes+workspace): active-process confirm + Open Folder UI`
- 34: `feat(topbar): Split menu popup + Shortcuts viewer modal`

**Process gate (per phase):**
Subagent-driven-development standard flow: implementer → spec compliance review → code quality review → fixes if any → holistic phase review at boundary. No release/CI work in this plan — your call to defer until the product feels right.

---

## File structure delivered by this plan

### New files
| Path | Responsibility |
|---|---|
| `src/store/toastStore.ts` | Zustand slice: array of active toasts, push/dismiss actions, auto-dismiss timer hooks. |
| `src/store/toastStore.test.ts` | Vitest coverage: push, auto-dismiss timing, sticky errors, max-4 stacking. |
| `src/components/Toaster.tsx` | Toast container fixed at bottom-right. Renders the active toast array. |
| `src/components/Toaster.module.css` | Toast styling per DESIGN.md §8 (positions, colors per severity, slide-in animation). |
| `src/components/ConfirmDialog.tsx` | Generic modal: title, message, confirm/cancel buttons. Used by active-process confirm + future surfaces. |
| `src/components/ConfirmDialog.module.css` | Centered overlay, backdrop, body sizing per modal pattern (no library — single dialog at a time is enough for v0.1). |
| `src/store/confirmStore.ts` | Zustand slice: single open/closed confirm dialog state with imperative `confirm({title, message, confirmLabel, danger?}) => Promise<boolean>`. |
| `src/components/SplitMenu.tsx` | Small popover anchored to ⊞ button. Three icons (→ ↑ ↓). Click closes + dispatches splitPane. |
| `src/components/SplitMenu.module.css` | Popover positioning + hover states. |
| `src/components/ShortcutsModal.tsx` | Read-only modal listing every shortcut from DESIGN.md §7 grouped by category. |
| `src/components/ShortcutsModal.module.css` | Modal table styling, keyboard chips. |
| `src/lib/dialogClient.ts` | Wrapper around `@tauri-apps/plugin-dialog`'s `open()` for the folder picker. Thin so it can be mocked. |

### Modified files
| Path | Change |
|---|---|
| `package.json` | Add `@tauri-apps/plugin-dialog` to dependencies. |
| `src-tauri/Cargo.toml` | Add `tauri-plugin-dialog = "2.0"`. |
| `src-tauri/src/lib.rs` | Register the dialog plugin via `.plugin(tauri_plugin_dialog::init())`. |
| `src-tauri/capabilities/default.json` | Add `dialog:default` to the permissions list. |
| `src-tauri/src/pty.rs` | Add `is_pty_busy(pane_id) -> bool` Tauri command — heuristic for "process tree under this PTY has more than just an idle shell". |
| `src/terminals/ptyClient.ts` | Wrapper for `isPtyBusy(paneId)`. |
| `src/components/PaneTree.tsx` | `onClose` (the × button) now checks `isPtyBusy` first; if busy, calls `confirmStore.confirm` before `closePane`. |
| `src/hooks/useKeyboardShortcuts.ts` | The Ctrl+W close-pane branch also goes through the busy-check. Ctrl+? opens the Shortcuts modal. Ctrl+K Ctrl+O opens the folder picker (chord — needs new state). |
| `src/components/TopBar.tsx` | ⊞ click opens SplitMenu popover (anchored). ⌨ click opens ShortcutsModal. New Open Folder button (or extend ⚙ with a sub-action — decide in Task 2.3). |
| `src/main.tsx` | Wire config-bootstrap error/warn surfaces to `toastStore.push(...)` instead of console-only. |
| `src/store/mdStore.ts` | `saveMdTab` failure dispatches an error toast. |
| `src/store/sidebarStore.ts` | New action `setWorkspaceFolder(path)` already exists — make sure it triggers a sidebar re-root + file-watcher re-attach. |
| `src/App.tsx` | Mount `<Toaster />` and `<ConfirmDialog />` and `<SplitMenu />` and `<ShortcutsModal />` as siblings to `<ContextMenu />` (all are portal-style overlays). |

---

## Process notes for the executing controller

- **One subagent per phase** (3 phases total), each ending in one bundle commit.
- **Two-stage review per phase:** spec compliance review against this plan, then code quality review against the resulting commit SHA.
- **Phase-boundary holistic review:** after the last commit of each phase, dispatch ONE additional code-reviewer subagent over the full phase diff and ask for cross-file consistency, theme-token usage, accessibility, DESIGN.md alignment.
- **Verification gates at every commit.** All five must be green.
- **No release work in this plan.** Weekend 5 (tests, CI, MSI) lands AFTER all product improvements are complete and the user has called it done.

---

# Phase 1 — Toast notification system (DESIGN.md §8)

**Why first:** every later phase wants a place to report errors and successes. Wiring this once now is cheaper than reaching for `console.error` in three phases and retrofitting later.

**Spec anchors:**
- DESIGN.md §8 (entire section — positions, durations, colors per severity).
- DESIGN.md §11 mentions toasts as the default error surface, with inline-in-pane for PTY spawn failures.

## Task 1.1: Toast store + tests (TDD)

**Files:**
- Create: `src/store/toastStore.ts`
- Create: `src/store/toastStore.test.ts`

- [ ] **Step 1: Write the failing tests first**

```typescript
// src/store/toastStore.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useToastStore, type ToastSeverity } from "@/store/toastStore";

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: vi.fn(async () => null),
    set: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  })),
}));

describe("toastStore", () => {
  beforeEach(() => {
    useToastStore.getState().reset();
    vi.useFakeTimers();
  });

  it("push adds a toast with a unique id", () => {
    useToastStore.getState().push({ severity: "success", message: "Saved" });
    useToastStore.getState().push({ severity: "info", message: "Reloaded" });
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(2);
    expect(new Set(toasts.map((t) => t.id)).size).toBe(2);
  });

  it("dismiss removes the toast by id", () => {
    const id = useToastStore.getState().push({ severity: "info", message: "x" });
    useToastStore.getState().dismiss(id);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("success/info/warn auto-dismiss after their duration", () => {
    useToastStore.getState().push({ severity: "success", message: "ok" });
    useToastStore.getState().push({ severity: "warn", message: "careful" });
    expect(useToastStore.getState().toasts).toHaveLength(2);

    vi.advanceTimersByTime(3001);
    // success has 3s timeout — gone
    let remaining = useToastStore.getState().toasts.map((t) => t.severity);
    expect(remaining).toEqual(["warn"]);

    vi.advanceTimersByTime(3001);
    // warn has 6s timeout — still present
    remaining = useToastStore.getState().toasts.map((t) => t.severity);
    expect(remaining).toEqual(["warn"]);

    vi.advanceTimersByTime(3000);
    // total 6001ms — warn now gone
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("error toasts are sticky (no auto-dismiss)", () => {
    useToastStore.getState().push({ severity: "error", message: "fail" });
    vi.advanceTimersByTime(60_000);
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });

  it("caps to MAX_VISIBLE toasts, dropping the oldest", () => {
    for (let i = 0; i < 8; i++) {
      useToastStore.getState().push({ severity: "info", message: `t${i}` });
    }
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(4); // MAX_VISIBLE
    expect(toasts.map((t) => t.message)).toEqual(["t4", "t5", "t6", "t7"]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL with "Cannot find module @/store/toastStore"**

```bash
npm test -- --run src/store/toastStore.test.ts
```

- [ ] **Step 3: Write the store**

```typescript
// src/store/toastStore.ts
//
// Toast notifications per DESIGN.md §8. Position bottom-right, max 4 visible,
// stack newest-on-top. Severity controls left-edge colour AND auto-dismiss
// timing:
//   success — 3s  (green left edge)
//   info    — 3s  (amber left edge)
//   warn    — 6s  (amber-dim left edge)
//   error   — sticky, requires explicit dismiss (red left edge)
//
// Timer references live in a module-level Map so we can clear them on
// explicit dismiss. The store itself stays a plain array.

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

export type ToastSeverity = "success" | "info" | "warn" | "error";

export interface Toast {
  id: string;
  severity: ToastSeverity;
  message: string;
  createdAt: number;
}

const MAX_VISIBLE = 4;

const DISMISS_MS: Record<ToastSeverity, number | null> = {
  success: 3000,
  info: 3000,
  warn: 6000,
  error: null,
};

const timers = new Map<string, ReturnType<typeof setTimeout>>();

let _seq = 0;
const nextId = () => `toast-${++_seq}`;

interface ToastState {
  toasts: Toast[];
}

interface ToastActions {
  push: (input: { severity: ToastSeverity; message: string }) => string;
  dismiss: (id: string) => void;
  reset: () => void;
}

export type ToastStore = ToastState & ToastActions;

export const useToastStore = create<ToastStore>()(
  devtools(
    immer((set, get) => ({
      toasts: [],

      push: ({ severity, message }) => {
        const id = nextId();
        const toast: Toast = { id, severity, message, createdAt: Date.now() };
        set((s) => {
          s.toasts.push(toast);
          // Cap at MAX_VISIBLE; drop oldest by shifting from the front.
          while (s.toasts.length > MAX_VISIBLE) {
            const dropped = s.toasts.shift();
            if (dropped) {
              const t = timers.get(dropped.id);
              if (t) {
                clearTimeout(t);
                timers.delete(dropped.id);
              }
            }
          }
        });
        const ms = DISMISS_MS[severity];
        if (ms !== null) {
          const handle = setTimeout(() => {
            get().dismiss(id);
          }, ms);
          timers.set(id, handle);
        }
        return id;
      },

      dismiss: (id) => {
        const t = timers.get(id);
        if (t) {
          clearTimeout(t);
          timers.delete(id);
        }
        set((s) => {
          s.toasts = s.toasts.filter((t) => t.id !== id);
        });
      },

      reset: () => {
        for (const t of timers.values()) clearTimeout(t);
        timers.clear();
        set((s) => {
          s.toasts = [];
        });
      },
    })),
    { name: "toastStore" }
  )
);
```

- [ ] **Step 4: Run — expect PASS**

```bash
npm test -- --run src/store/toastStore.test.ts
```

Expected: 5/5 passing.

- [ ] **Step 5: Commit (deferred — bundles with rest of Phase 1)**

---

## Task 1.2: Toaster component + CSS

**Files:**
- Create: `src/components/Toaster.tsx`
- Create: `src/components/Toaster.module.css`

- [ ] **Step 1: Write `Toaster.module.css`**

```css
/* src/components/Toaster.module.css
 *
 * DESIGN.md §8 — bottom-right, above the Status Bar with 16px margin.
 * Stack newest-on-top. 180ms slide-in-from-right + fade. */

.root {
  position: fixed;
  bottom: calc(24px + 16px); /* status-bar height + spec margin */
  right: 16px;
  display: flex;
  flex-direction: column-reverse; /* newest on top */
  gap: 8px;
  z-index: 100;
  pointer-events: none; /* clicks pass through gaps */
}

.toast {
  pointer-events: auto;
  min-width: 280px;
  max-width: 480px;
  background: var(--bg-2);
  color: var(--fg-0);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font-family: var(--font-ui);
  font-size: 13px;
  display: flex;
  align-items: stretch;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
  animation: slideIn 180ms ease-out;
}

.edge {
  width: 3px;
  flex-shrink: 0;
}

.edge.success { background: var(--success); }
.edge.info    { background: var(--accent); }
.edge.warn    { background: var(--accent-dim); }
.edge.error   { background: var(--error); }

.body {
  flex: 1;
  padding: 8px var(--space-3);
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
}

.message {
  flex: 1;
  min-width: 0;
  word-break: break-word;
}

.closeBtn {
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--fg-2);
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  border-radius: var(--radius-sm);
}
.closeBtn:hover {
  color: var(--fg-0);
  background: var(--bg-3);
}

@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateX(20px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}
```

- [ ] **Step 2: Write `Toaster.tsx`**

```tsx
// src/components/Toaster.tsx
//
// Renders the toastStore. Fixed bottom-right per DESIGN.md §8.

import styles from "@/components/Toaster.module.css";
import { useToastStore } from "@/store/toastStore";

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  return (
    <div className={styles.root} aria-live="polite" aria-atomic="false">
      {toasts.map((t) => (
        <div key={t.id} className={styles.toast} role="status">
          <div className={`${styles.edge} ${styles[t.severity]}`} />
          <div className={styles.body}>
            <span className={styles.message}>{t.message}</span>
            <button
              className={styles.closeBtn}
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss notification"
              title="Dismiss"
            >
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Mount in App.tsx**

In `src/App.tsx`, add the import:
```tsx
import { Toaster } from "@/components/Toaster";
```

And add `<Toaster />` as a sibling to `<ContextMenu />` (both are portal-style overlays — order doesn't matter):
```tsx
      <ContextMenu />
      <Toaster />
```

- [ ] **Step 4: Run typecheck**

```bash
npm run typecheck
```
Expected: clean.

- [ ] **Step 5: Commit (deferred)**

---

## Task 1.3: Wire existing silent failures to toasts

**Files:**
- Modify: `src/main.tsx`
- Modify: `src/store/mdStore.ts` (saveMdTab failure)
- Modify: `src/components/Sidebar.tsx` (new-file failure)

- [ ] **Step 1: Wire config bootstrap failures**

In `src/main.tsx`, replace the `console.error("config bootstrap failed; keeping defaults", err);` line with both a console.error AND a toast push:

```tsx
import { useToastStore } from "@/store/toastStore";

// inside the bootstrap IIFE, in the catch:
} catch (err) {
  console.error("config bootstrap failed; keeping defaults", err);
  useToastStore.getState().push({
    severity: "warn",
    message: "Couldn't read config.toml; using defaults. Check the log for details.",
  });
}
```

Same shape for the `watchConfig` failure block — push a warn toast in addition to the console.warn.

And the hot-reload parse-failure block:
```tsx
console.warn("hot reload parse failed; keeping last valid", err);
useToastStore.getState().push({
  severity: "warn",
  message: "Config has errors; keeping last valid values.",
});
useSettingsStore.getState().revertToLastValid();
```

- [ ] **Step 2: Wire save failures**

In `src/store/mdStore.ts`, the `saveMdTab` action currently just throws. Wrap the `writeTextFile` call:

```typescript
import { useToastStore } from "@/store/toastStore";

saveMdTab: async (id) => {
  const t = get().tabs.find((t) => t.id === id);
  if (!t) return;
  try {
    await writeTextFile(t.path, t.content);
    set((s) => {
      const tt = s.tabs.find((t) => t.id === id);
      if (tt) tt.dirty = false;
    });
    useToastStore.getState().push({
      severity: "success",
      message: `Saved ${t.path.split(/[/\\]/).pop() ?? t.path}`,
    });
  } catch (err) {
    useToastStore.getState().push({
      severity: "error",
      message: `Save failed: ${err instanceof Error ? err.message : String(err)}`,
    });
    throw err;
  }
},
```

- [ ] **Step 3: Wire new-file failures in Sidebar**

In `src/components/Sidebar.tsx`, the `onNewFile` catch currently just `console.error`s. Add a toast push.

```tsx
} catch (e) {
  console.error("new file failed", e);
  useToastStore.getState().push({
    severity: "error",
    message: `Could not create file: ${e instanceof Error ? e.message : String(e)}`,
  });
}
```

- [ ] **Step 4: Run the full suite**

```bash
npm run typecheck
npm test -- --run
cargo test --lib --manifest-path src-tauri/Cargo.toml
cargo clippy --all-targets --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check
```

Expected: vitest 107 → 112 (5 new toastStore tests), cargo unchanged, all gates green.

- [ ] **Step 5: Commit the Phase 1 bundle**

```bash
git add src/store/toastStore.ts src/store/toastStore.test.ts src/components/Toaster.tsx src/components/Toaster.module.css src/App.tsx src/main.tsx src/store/mdStore.ts src/components/Sidebar.tsx
git commit -m "$(cat <<'EOF'
feat(toast): notification surface per DESIGN.md §8

New toastStore (Zustand + immer + devtools) holds an array of active
toasts with per-severity auto-dismiss timers. Toaster component renders
them fixed bottom-right, above the Status Bar with the 16px margin from
§8. Max 4 visible — older ones drop. Slide-in-from-right animation
180ms.

Severity → color edge (3px) + dismiss timing:
  success — 3s  green
  info    — 3s  amber
  warn    — 6s  amber-dim
  error   — sticky, requires explicit dismiss, red

Wired previously-silent failure modes:
  - config bootstrap failure → warn toast
  - config hot-reload parse failure → warn toast + revertToLastValid
  - mdStore.saveMdTab success → success toast
  - mdStore.saveMdTab failure → error toast (sticky)
  - Sidebar onNewFile failure → error toast

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Phase 1 — Holistic review

- [ ] Dispatch code-reviewer subagent with `git diff HEAD~1..HEAD` and check:
  - Toast positions match DESIGN.md §8 (bottom-right, 16px margin above Status Bar).
  - Severity → color mapping matches §8 (green/amber/amber-dim/red).
  - Max 4 visible, oldest dropped.
  - Slide-in animation present, 180ms.
  - `aria-live="polite"` on the container; each toast has `role="status"`.
  - Every wired-up failure site (config bootstrap, save, new-file) actually fires its toast.
  - No raw hex; all colours via tokens.

---

# Phase 2 — Active-process confirm dialog + Open Folder UI

**Why this phase:** Two distinct user actions that both need modal/dialog infrastructure. Building a small confirm-dialog primitive once serves both.

**Spec anchors:**
- DESIGN.md §1 invariant 3 + CONTEXT.md "Workstation invariants" #3: closing a Terminal Pane with an active child process must show a confirm dialog before terminating the PTY.
- DESIGN.md §3 "Open Folder" + CONTEXT.md "Workspace Folder": user changes the workspace folder via a top-bar "Open Folder" button or Ctrl+K Ctrl+O.

## Task 2.1: Install dialog plugin + capability

**Files:**
- Modify: `package.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/capabilities/default.json`

- [ ] **Step 1: Install the plugin**

```bash
npm i @tauri-apps/plugin-dialog@^2
```

- [ ] **Step 2: Add the Rust crate to `src-tauri/Cargo.toml`**

```toml
tauri-plugin-dialog = "2.0"
```

- [ ] **Step 3: Register the plugin in `src-tauri/src/lib.rs`**

Add to the `tauri::Builder` chain alongside the existing plugins:
```rust
        .plugin(tauri_plugin_dialog::init())
```

Insert it next to `.plugin(tauri_plugin_shell::init())` for grouping.

- [ ] **Step 4: Add capability permission**

In `src-tauri/capabilities/default.json`, append to the `permissions` array:
```json
    "dialog:default"
```

- [ ] **Step 5: Verify build works**

```bash
cargo build --manifest-path src-tauri/Cargo.toml
```
Expected: clean compile (might re-fetch crates first time).

- [ ] **Step 6: Commit (deferred — bundles with rest of Phase 2)**

---

## Task 2.2: `is_pty_busy` Tauri command + TS wrapper

**Files:**
- Modify: `src-tauri/src/pty.rs`
- Modify: `src-tauri/src/lib.rs` (register the new command)
- Modify: `src/terminals/ptyClient.ts`

### Background

On Windows, the cleanest way to ask "does this PTY's child process have any sub-process beyond the shell" is to walk the process tree from the shell PID. `portable-pty` exposes the child process via `.child_pid()` or similar; the rest is Win32 process-tree traversal.

For v0.1 we use a **simple heuristic** instead: count direct children of the PTY's shell process. If count > 0, busy. This is imperfect (a shell that ran a quick command and is back at the prompt has 0 children, but a long-running `tail -f` has 1+). Good enough for the "I'm about to kill Claude Code mid-task" case which is the actual user pain point.

- [ ] **Step 1: Write the heuristic in `src-tauri/src/pty.rs`**

Add to `src-tauri/src/pty.rs` (consult the existing `PtyRegistry` definition to know how to find the shell PID per pane):

```rust
#[tauri::command]
pub fn is_pty_busy(state: tauri::State<'_, PtyRegistry>, pane_id: String) -> AppResult<bool> {
    // Look up the pane's shell PID. If the pane is unknown or its shell is
    // gone, treat as not busy (nothing to confirm).
    let pid = match state.shell_pid(&pane_id) {
        Some(p) => p,
        None => return Ok(false),
    };
    Ok(child_count(pid) > 0)
}

#[cfg(target_os = "windows")]
fn child_count(parent_pid: u32) -> u32 {
    // Walk the snapshot of all processes; count those whose ParentProcessID
    // matches parent_pid. Win32 Toolhelp32 API.
    use std::ptr::null_mut;
    use winapi::um::tlhelp32::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };
    use winapi::um::handleapi::{CloseHandle, INVALID_HANDLE_VALUE};

    unsafe {
        let snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snap == INVALID_HANDLE_VALUE {
            return 0;
        }
        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut count = 0u32;
        if Process32FirstW(snap, &mut entry) != 0 {
            loop {
                if entry.th32ParentProcessID == parent_pid {
                    count += 1;
                }
                if Process32NextW(snap, &mut entry) == 0 {
                    break;
                }
            }
        }
        CloseHandle(snap);
        count
    }
}

#[cfg(not(target_os = "windows"))]
fn child_count(_parent_pid: u32) -> u32 {
    // v0.1 only ships Windows. Unix support arrives with macOS/Linux
    // installers in v0.4+; revisit then.
    0
}
```

**Important:** The `winapi` crate is not yet in `src-tauri/Cargo.toml`. Add it as a target-specific dependency:

```toml
[target.'cfg(windows)'.dependencies]
winapi = { version = "0.3", features = ["tlhelp32", "handleapi"] }
```

> **Implementer note:** If `PtyRegistry` doesn't expose a `shell_pid(&pane_id)` method, you'll need to add one. Read `src-tauri/src/pty.rs` to find the existing storage (likely `DashMap<PaneId, PtyChild>` or similar) and add a method that returns `Option<u32>` for the child PID. If the existing struct holds the `Child` from `portable_pty::PtyPair::slave.spawn_command()`, `child.process_id()` returns `Option<u32>` on Windows.

- [ ] **Step 2: Register the new command**

In `src-tauri/src/lib.rs`, add `pty::is_pty_busy` to the `tauri::generate_handler!` list alongside the existing `pty::pty_*` commands.

- [ ] **Step 3: Write the TS wrapper**

In `src/terminals/ptyClient.ts`, add:

```typescript
export function isPtyBusy(paneId: string): Promise<boolean> {
  return invoke<boolean>("is_pty_busy", { paneId });
}
```

- [ ] **Step 4: Verify Rust gates**

```bash
cargo test --lib --manifest-path src-tauri/Cargo.toml
cargo clippy --all-targets --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check
```

Expected: all green. No new Rust tests added — the heuristic is OS-dependent and hard to unit-test deterministically. v0.2 polish could add an integration test that spawns a known child.

- [ ] **Step 5: Commit (deferred)**

---

## Task 2.3: ConfirmDialog primitive + confirmStore

**Files:**
- Create: `src/store/confirmStore.ts`
- Create: `src/components/ConfirmDialog.tsx`
- Create: `src/components/ConfirmDialog.module.css`

- [ ] **Step 1: Write `confirmStore.ts`**

```typescript
// src/store/confirmStore.ts
//
// Imperative confirm dialog. Single dialog at a time — sequential, not
// stacked. Caller awaits a Promise<boolean>; the dialog resolves with
// true on confirm, false on cancel or backdrop click.

import { create } from "zustand";
import { devtools } from "zustand/middleware";

export interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface ConfirmState {
  open: boolean;
  request: ConfirmRequest | null;
  _resolve: ((value: boolean) => void) | null;
}

interface ConfirmActions {
  confirm: (request: ConfirmRequest) => Promise<boolean>;
  resolve: (value: boolean) => void;
}

export type ConfirmStore = ConfirmState & ConfirmActions;

export const useConfirmStore = create<ConfirmStore>()(
  devtools(
    (set, get) => ({
      open: false,
      request: null,
      _resolve: null,

      confirm: (request) => {
        // Queue policy: if another dialog is open, immediately resolve the
        // new request as false (don't queue). Keeps UX predictable.
        if (get().open) return Promise.resolve(false);
        return new Promise<boolean>((resolve) => {
          set({ open: true, request, _resolve: resolve });
        });
      },

      resolve: (value) => {
        const r = get()._resolve;
        set({ open: false, request: null, _resolve: null });
        if (r) r(value);
      },
    }),
    { name: "confirmStore" }
  )
);
```

- [ ] **Step 2: Write `ConfirmDialog.module.css`**

```css
/* src/components/ConfirmDialog.module.css */

.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 99;
  display: flex;
  align-items: center;
  justify-content: center;
}

.dialog {
  background: var(--bg-1);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font-family: var(--font-ui);
  color: var(--fg-0);
  min-width: 360px;
  max-width: 480px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.6);
}

.header {
  padding: var(--space-3);
  border-bottom: 1px solid var(--border);
  font-size: 13px;
  color: var(--fg-heading);
  font-weight: 600;
}

.body {
  padding: var(--space-3);
  font-size: 13px;
  color: var(--fg-0);
  line-height: 1.5;
}

.footer {
  padding: var(--space-2) var(--space-3);
  border-top: 1px solid var(--border);
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}

.btn {
  background: var(--bg-2);
  color: var(--fg-0);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 6px var(--space-3);
  font-family: var(--font-ui);
  font-size: 12px;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease;
}
.btn:hover {
  background: var(--bg-3);
  border-color: var(--accent-dim);
}
.btn.confirm {
  background: var(--accent);
  color: var(--bg-0);
  border-color: var(--accent);
}
.btn.confirm:hover {
  background: var(--accent-dim);
}
.btn.danger {
  background: var(--error);
  color: #ffffff;
  border-color: var(--error);
}
.btn.danger:hover {
  background: #c44a4a;
}
```

- [ ] **Step 3: Write `ConfirmDialog.tsx`**

```tsx
// src/components/ConfirmDialog.tsx

import { useEffect } from "react";
import styles from "@/components/ConfirmDialog.module.css";
import { useConfirmStore } from "@/store/confirmStore";

export function ConfirmDialog() {
  const open = useConfirmStore((s) => s.open);
  const request = useConfirmStore((s) => s.request);
  const resolve = useConfirmStore((s) => s.resolve);

  // Esc cancels; Enter confirms. Capture phase so it wins over xterm.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        resolve(false);
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        resolve(true);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, resolve]);

  if (!open || !request) return null;

  const confirmLabel = request.confirmLabel ?? "Confirm";
  const cancelLabel = request.cancelLabel ?? "Cancel";
  const danger = request.danger === true;

  return (
    <div
      className={styles.backdrop}
      onClick={() => resolve(false)}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header} id="confirm-dialog-title">
          {request.title}
        </div>
        <div className={styles.body}>{request.message}</div>
        <div className={styles.footer}>
          <button className={styles.btn} onClick={() => resolve(false)} autoFocus={!danger}>
            {cancelLabel}
          </button>
          <button
            className={`${styles.btn} ${danger ? styles.danger : styles.confirm}`}
            onClick={() => resolve(true)}
            autoFocus={danger}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Mount in App.tsx**

```tsx
import { ConfirmDialog } from "@/components/ConfirmDialog";
// ...
      <ContextMenu />
      <Toaster />
      <ConfirmDialog />
```

- [ ] **Step 5: Typecheck**

```bash
npm run typecheck
```
Expected: clean.

- [ ] **Step 6: Commit (deferred)**

---

## Task 2.4: Wire active-process confirm into pane close

**Files:**
- Modify: `src/components/PaneTree.tsx`
- Modify: `src/hooks/useKeyboardShortcuts.ts`

- [ ] **Step 1: Update `PaneTree.tsx`'s `LeafFrame` onClose**

Currently the × button calls `closePane(paneId)` directly. Change to:

```tsx
import { isPtyBusy } from "@/terminals/ptyClient";
import { useConfirmStore } from "@/store/confirmStore";

// inside LeafFrameImpl, replace onClose:
const onClose = async (e: ReactMouseEvent<HTMLButtonElement>) => {
  e.preventDefault();
  e.stopPropagation();
  try {
    const busy = await isPtyBusy(paneId);
    if (busy) {
      const ok = await useConfirmStore.getState().confirm({
        title: "Close pane with running process?",
        message: `${paneId} appears to be running a process. Closing the pane will terminate it.`,
        confirmLabel: "Close anyway",
        cancelLabel: "Keep open",
        danger: true,
      });
      if (!ok) return;
    }
  } catch (err) {
    // is_pty_busy failed — fall through and close anyway. Better to allow
    // close than to soft-lock the pane.
    console.warn("isPtyBusy check failed", err);
  }
  closePane(paneId);
};
```

- [ ] **Step 2: Update Ctrl+W in keyboard shortcuts**

In `src/hooks/useKeyboardShortcuts.ts`, modify the `closeFocused` helper (it currently calls `useLayoutStore.getState().closePane(focused)` directly):

```typescript
async function closeFocusedAsync(): Promise<boolean> {
  const focused = focusedPaneOrNull();
  if (focused === null) return false;
  try {
    const { isPtyBusy } = await import("@/terminals/ptyClient");
    const busy = await isPtyBusy(focused);
    if (busy) {
      const { useConfirmStore } = await import("@/store/confirmStore");
      const ok = await useConfirmStore.getState().confirm({
        title: "Close pane with running process?",
        message: `${focused} appears to be running a process. Closing the pane will terminate it.`,
        confirmLabel: "Close anyway",
        cancelLabel: "Keep open",
        danger: true,
      });
      if (!ok) return false;
    }
  } catch (err) {
    console.warn("isPtyBusy check failed", err);
  }
  useLayoutStore.getState().closePane(focused);
  return true;
}

function closeFocused(): boolean {
  // Fire-and-forget the async path; the shortcut returns true synchronously
  // to consume the keystroke. The async close happens shortly after.
  void closeFocusedAsync();
  return true;
}
```

> **Implementer note:** The dynamic imports avoid creating an import cycle with the store layer. Static imports are also fine — pick whichever passes the existing lint rules.

- [ ] **Step 3: Verification**

```bash
npm run typecheck
npm test -- --run
```

Expected: clean typecheck, 112 tests passing (no new tests for this task — manual smoke covers the heuristic).

- [ ] **Step 4: Commit (deferred)**

---

## Task 2.5: Open Folder UI

**Files:**
- Create: `src/lib/dialogClient.ts`
- Modify: `src/components/TopBar.tsx`
- Modify: `src/store/sidebarStore.ts` (confirm `setWorkspaceFolder` triggers a re-root)
- Modify: `src/hooks/useKeyboardShortcuts.ts` (Ctrl+K Ctrl+O chord)

- [ ] **Step 1: Write `dialogClient.ts`**

```typescript
// src/lib/dialogClient.ts
//
// Thin wrapper around @tauri-apps/plugin-dialog for an OS folder picker.
// Kept thin so the open-folder action in TopBar / shortcuts is testable
// by mocking this module.

import { open } from "@tauri-apps/plugin-dialog";

export async function pickFolder(): Promise<string | null> {
  const selected = await open({ directory: true, multiple: false });
  if (selected === null) return null;
  if (Array.isArray(selected)) return selected[0] ?? null;
  return selected;
}
```

- [ ] **Step 2: Add Open Folder button to TopBar**

In `src/components/TopBar.tsx`, add an icon button. Pick a position: per DESIGN.md §3 ASCII art the Open Folder action lives in the top bar but isn't pictured at a specific slot. Putting it in the left cluster next to 🗎 reads naturally for a workspace-level action. Use a 📂 icon (or a Lucide folder SVG — see PenIcon in MdEditor.tsx for the SVG-component pattern).

```tsx
import { pickFolder } from "@/lib/dialogClient";

// inside the component:
const setWorkspaceFolder = useSidebarStore((s) => s.setWorkspaceFolder);

const onOpenFolder = async () => {
  try {
    const folder = await pickFolder();
    if (folder !== null) {
      setWorkspaceFolder(folder);
    }
  } catch (err) {
    console.error("Open Folder failed", err);
    useToastStore.getState().push({
      severity: "error",
      message: `Couldn't open folder: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
};

// add the button INSIDE the .left div, between ⊞ and 🗎 or wherever reads cleanest:
<button
  className={styles.btn}
  title="Open Folder (Ctrl+K Ctrl+O)"
  aria-label="Open Folder"
  data-tauri-drag-region="false"
  onClick={onOpenFolder}
>
  📂
</button>
```

> **Implementer note:** The TopBar.test.tsx drag-region invariant test asserts every clickable has `data-tauri-drag-region="false"`. Adding a new button with the attribute keeps the count at ≥9 and the test passes.

- [ ] **Step 3: Make sure `setWorkspaceFolder` triggers a re-root + watcher restart**

Read `src/components/Sidebar.tsx`. The two `useEffect` blocks (one for `workspaceFolder` change → bootstrap home dir, one for `workspaceFolder` change → file watcher) should fire when `setWorkspaceFolder` changes the value because they list `workspaceFolder` in their deps array.

Verify:
- The watch_workspace Tauri command tolerates being called twice (it replaces the previous watcher — see `src-tauri/src/file_watcher.rs:73`). Good.
- The Sidebar's tree state needs reset for the new folder. The current Sidebar code doesn't explicitly call `listDir(newFolder)`; the file watcher's initial `Rescan` event handles it. Confirm this works on folder change by reading the existing useEffect.

If the Sidebar doesn't re-list the new folder on its own, add an explicit reset action to `sidebarStore`:

```typescript
// in src/store/sidebarStore.ts — extend the setWorkspaceFolder action to
// also clear the entries Map + expanded Set so the new folder doesn't
// inherit the old tree state.
setWorkspaceFolder: (path) =>
  set((s) => {
    s.workspaceFolder = path;
    s.entries = new Map();
    s.expanded = new Set();
  }),
```

This is a NECESSARY change — without it, switching workspace folders would leave the old folder's `entries` Map in the store and the Sidebar would render a mix.

- [ ] **Step 4: Add the Ctrl+K Ctrl+O chord shortcut**

Chord shortcuts require a tiny state machine — the first key arms the chord, the second resolves it. Add to `src/hooks/useKeyboardShortcuts.ts`:

```typescript
// Chord state for Ctrl+K-prefixed shortcuts. Resets after 1.5s of inactivity.
let chordPrefix: "ctrl-k" | null = null;
let chordTimer: number | null = null;

function armChord(prefix: "ctrl-k"): void {
  chordPrefix = prefix;
  if (chordTimer !== null) window.clearTimeout(chordTimer);
  chordTimer = window.setTimeout(() => {
    chordPrefix = null;
    chordTimer = null;
  }, 1500);
}

function clearChord(): void {
  chordPrefix = null;
  if (chordTimer !== null) {
    window.clearTimeout(chordTimer);
    chordTimer = null;
  }
}
```

Then in the SHORTCUTS array, add two entries BEFORE the existing Ctrl+O entry:

```typescript
  // Chord prefix: Ctrl+K alone arms the chord. The next keypress
  // resolves it. Released after 1.5s if no follow-up.
  {
    match: (e) => isCtrlOnly(e) && (e.key === "k" || e.key === "K") && chordPrefix === null,
    run: () => {
      armChord("ctrl-k");
      return true;
    },
  },

  // Resolution: Ctrl+K → Ctrl+O opens the folder picker.
  {
    match: (e) =>
      chordPrefix === "ctrl-k" && isCtrlOnly(e) && (e.key === "o" || e.key === "O"),
    run: () => {
      clearChord();
      void (async () => {
        const { pickFolder } = await import("@/lib/dialogClient");
        const folder = await pickFolder();
        if (folder !== null) {
          useSidebarStore.getState().setWorkspaceFolder(folder);
        }
      })();
      return true;
    },
  },
```

- [ ] **Step 5: Run the full suite**

```bash
npm run typecheck
npm test -- --run
cargo test --lib --manifest-path src-tauri/Cargo.toml
cargo clippy --all-targets --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check
```

Expected: 112 vitest, 20 cargo, all gates green. The TopBar drag-region test now finds 10 controls (was 9) and still passes.

- [ ] **Step 6: Commit the Phase 2 bundle**

```bash
git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs src-tauri/src/pty.rs src-tauri/capabilities/default.json src/terminals/ptyClient.ts src/store/confirmStore.ts src/components/ConfirmDialog.tsx src/components/ConfirmDialog.module.css src/components/PaneTree.tsx src/hooks/useKeyboardShortcuts.ts src/lib/dialogClient.ts src/components/TopBar.tsx src/store/sidebarStore.ts src/App.tsx
git commit -m "$(cat <<'EOF'
feat(panes+workspace): active-process confirm + Open Folder UI

Two surfaces DESIGN.md promised v0.1 would have:

1. Closing a pane with a running child process now triggers a confirm
   dialog (CONTEXT.md invariant 3). is_pty_busy Tauri command counts
   direct child processes via Win32 Toolhelp32 snapshot — heuristic, but
   covers the "I'm about to kill Claude Code mid-task" case. Wired into
   both the × button on the pane and Ctrl+W from the keyboard.

2. New 📂 Open Folder button in the TopBar (and Ctrl+K Ctrl+O chord) opens
   an OS folder picker via @tauri-apps/plugin-dialog. Picking a folder
   sets sidebarStore.workspaceFolder, which resets the tree state and
   restarts the file watcher. Existing terminals are NOT auto-cd'd per
   CONTEXT.md.

Supporting infrastructure:
  - confirmStore: imperative Promise<boolean> dialog primitive.
  - ConfirmDialog: backdrop + dialog with Esc/Enter handling.
  - dialogClient: thin wrapper around plugin-dialog.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Phase 2 — Holistic review

- [ ] Dispatch reviewer with `git diff HEAD~1..HEAD`:
  - is_pty_busy uses the correct PID source (the shell child's PID, not the Tauri parent process).
  - The Win32 child_count helper releases the snapshot handle in all paths.
  - The confirm dialog correctly cancels on Esc and confirms on Enter.
  - Backdrop click cancels; clicks inside the dialog body don't.
  - The Open Folder flow correctly resets `entries` and `expanded` on sidebarStore.
  - The chord state machine cleans up its timeout in the unmount cleanup of `useKeyboardShortcuts`.

---

# Phase 3 — Split menu popup + Shortcuts viewer modal

**Spec anchors:**
- DESIGN.md §3 (Top Bar ⊞ Split menu — popup with three direction icons).
- DESIGN.md §7 (entire keyboard shortcuts table — the canonical list to render).

## Task 3.1: Split menu popup

**Files:**
- Create: `src/components/SplitMenu.tsx`
- Create: `src/components/SplitMenu.module.css`
- Create: `src/store/splitMenuStore.ts` (tiny — just open/anchor coordinates)
- Modify: `src/components/TopBar.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Write `splitMenuStore.ts`**

```typescript
// src/store/splitMenuStore.ts
//
// Minimal store for the ⊞ split menu popup. open + anchor coords.

import { create } from "zustand";

interface SplitMenuState {
  open: boolean;
  anchorX: number;
  anchorY: number;
}
interface SplitMenuActions {
  show: (x: number, y: number) => void;
  close: () => void;
}

export const useSplitMenuStore = create<SplitMenuState & SplitMenuActions>((set) => ({
  open: false,
  anchorX: 0,
  anchorY: 0,
  show: (x, y) => set({ open: true, anchorX: x, anchorY: y }),
  close: () => set({ open: false }),
}));
```

- [ ] **Step 2: Write `SplitMenu.module.css`**

```css
/* src/components/SplitMenu.module.css */

.menu {
  position: fixed;
  background: var(--bg-1);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  padding: 4px;
  display: flex;
  gap: 2px;
  z-index: 95;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
}

.item {
  width: 32px;
  height: 32px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  color: var(--fg-1);
  font-size: 14px;
  font-family: var(--font-ui);
}
.item:hover {
  color: var(--fg-0);
  background: var(--bg-2);
  border-color: var(--accent-dim);
}
```

- [ ] **Step 3: Write `SplitMenu.tsx`**

```tsx
// src/components/SplitMenu.tsx
//
// Popup anchored under the ⊞ button. Three direction icons (→ ↑ ↓).
// Each closes the popup and splits the focused pane.

import { useEffect, useRef } from "react";
import styles from "@/components/SplitMenu.module.css";
import { useSplitMenuStore } from "@/store/splitMenuStore";
import { useLayoutStore } from "@/store/layoutStore";
import { nextPaneId } from "@/lib/paneIds";

export function SplitMenu() {
  const open = useSplitMenuStore((s) => s.open);
  const x = useSplitMenuStore((s) => s.anchorX);
  const y = useSplitMenuStore((s) => s.anchorY);
  const close = useSplitMenuStore((s) => s.close);
  const ref = useRef<HTMLDivElement | null>(null);

  // Click outside closes.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open, close]);

  if (!open) return null;

  const doSplit = (dir: "right" | "down" | "up") => {
    const focused = useLayoutStore.getState().focusedPaneId;
    if (focused === null) return;
    useLayoutStore.getState().splitPane(dir, nextPaneId(), focused);
    close();
  };

  return (
    <div ref={ref} className={styles.menu} style={{ left: x, top: y }} role="menu">
      <button
        className={styles.item}
        onClick={() => doSplit("right")}
        title="Split right (Ctrl+Alt+→)"
        aria-label="Split right"
      >
        →
      </button>
      <button
        className={styles.item}
        onClick={() => doSplit("up")}
        title="Split up (Ctrl+Alt+↑)"
        aria-label="Split up"
      >
        ↑
      </button>
      <button
        className={styles.item}
        onClick={() => doSplit("down")}
        title="Split down (Ctrl+Alt+↓)"
        aria-label="Split down"
      >
        ↓
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Hook into TopBar's ⊞ button**

In `src/components/TopBar.tsx`, replace the existing `onClick={() => onSplit("right")}` on the ⊞ button with a handler that opens the popup anchored below the button:

```tsx
import { useSplitMenuStore } from "@/store/splitMenuStore";

// inside the component, remove or refactor onSplit (it's no longer used):
// Keep the existing onSplit signature so future direct-keyboard shortcuts
// can still use it; but the ⊞ click now opens the menu.

const showSplitMenu = (e: React.MouseEvent<HTMLButtonElement>) => {
  const rect = e.currentTarget.getBoundingClientRect();
  useSplitMenuStore.getState().show(rect.left, rect.bottom + 4);
};

// on the ⊞ button:
onClick={showSplitMenu}
```

Update the `title` from "Split focused pane right (Ctrl+Alt+→)" to "Split focused pane (Ctrl+Alt+→/↑/↓)".

- [ ] **Step 5: Mount SplitMenu in App.tsx**

```tsx
import { SplitMenu } from "@/components/SplitMenu";
// ...
      <Toaster />
      <ConfirmDialog />
      <SplitMenu />
```

- [ ] **Step 6: Update TopBar click test**

In `src/components/TopBar.test.tsx`, the existing "clicking the Split button calls splitPane" test will need updating — the click no longer calls splitPane directly; it shows the menu. Change the assertion to either:
(a) confirm the click does NOT call splitPane synchronously, OR
(b) confirm the click DOES call `useSplitMenuStore.show`.

Easiest: mock `useSplitMenuStore` the same way the other stores are mocked at the top of the test file, then assert `show` was called.

- [ ] **Step 7: Typecheck + vitest**

```bash
npm run typecheck
npm test -- --run
```
Expected: 112 passing (no count change — TopBar test was updated, not added).

- [ ] **Step 8: Commit (deferred)**

---

## Task 3.2: Shortcuts viewer modal

**Files:**
- Create: `src/components/ShortcutsModal.tsx`
- Create: `src/components/ShortcutsModal.module.css`
- Create: `src/store/shortcutsModalStore.ts`
- Modify: `src/components/TopBar.tsx`
- Modify: `src/hooks/useKeyboardShortcuts.ts` (Ctrl+? binding)
- Modify: `src/App.tsx`

- [ ] **Step 1: Write `shortcutsModalStore.ts`**

```typescript
// src/store/shortcutsModalStore.ts
import { create } from "zustand";

interface State { open: boolean }
interface Actions { open: () => void; close: () => void; toggle: () => void }

export const useShortcutsModalStore = create<State & Actions>((set, get) => ({
  open: false,
  open: () => set({ open: true }),    // Note: TypeScript will complain about
  close: () => set({ open: false }),  // 'open' being both a key and action.
  toggle: () => set({ open: !get().open }),
}));
```

> **Implementer note:** Rename the action `open` to `openModal` to avoid the field/action name collision. Same for `close` → `closeModal`. Update the modal component accordingly.

Corrected version:

```typescript
import { create } from "zustand";

interface State { open: boolean }
interface Actions { openModal: () => void; closeModal: () => void; toggle: () => void }

export const useShortcutsModalStore = create<State & Actions>((set, get) => ({
  open: false,
  openModal: () => set({ open: true }),
  closeModal: () => set({ open: false }),
  toggle: () => set({ open: !get().open }),
}));
```

- [ ] **Step 2: Write `ShortcutsModal.module.css`**

```css
/* src/components/ShortcutsModal.module.css */

.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 98;
  display: flex;
  align-items: center;
  justify-content: center;
}

.modal {
  background: var(--bg-1);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font-family: var(--font-ui);
  color: var(--fg-0);
  width: min(640px, calc(100vw - 64px));
  max-height: calc(100vh - 96px);
  display: flex;
  flex-direction: column;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.6);
}

.header {
  padding: var(--space-3);
  border-bottom: 1px solid var(--border);
  font-size: 13px;
  color: var(--fg-heading);
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.closeBtn {
  width: 24px;
  height: 24px;
  background: transparent;
  color: var(--fg-1);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-size: 14px;
}
.closeBtn:hover {
  color: var(--fg-0);
  background: var(--bg-2);
  border-color: var(--accent-dim);
}

.body {
  overflow-y: auto;
  padding: var(--space-3);
}

.group {
  margin-bottom: var(--space-4);
}
.groupHeader {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--fg-2);
  margin-bottom: var(--space-2);
}

.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 0;
  font-size: 13px;
}

.label {
  color: var(--fg-0);
}

.keys {
  display: inline-flex;
  gap: 4px;
  flex-shrink: 0;
}

.key {
  background: var(--bg-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 1px 6px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--fg-0);
}
```

- [ ] **Step 3: Write `ShortcutsModal.tsx` with the shortcut catalog**

```tsx
// src/components/ShortcutsModal.tsx
//
// Read-only modal listing every shortcut from DESIGN.md §7. Grouped by
// category. Kept as a static data array — when DESIGN.md §7 changes, update
// here. There's no shared source of truth in v0.1; v0.2 polish could
// derive this from a config layer.

import { useEffect } from "react";
import styles from "@/components/ShortcutsModal.module.css";
import { useShortcutsModalStore } from "@/store/shortcutsModalStore";

interface ShortcutRow {
  label: string;
  keys: string[];
}
interface ShortcutGroup {
  name: string;
  rows: ShortcutRow[];
}

const CATALOG: ShortcutGroup[] = [
  {
    name: "Panes",
    rows: [
      { label: "Split right", keys: ["Ctrl", "Alt", "→"] },
      { label: "Split up", keys: ["Ctrl", "Alt", "↑"] },
      { label: "Split down", keys: ["Ctrl", "Alt", "↓"] },
      { label: "Focus right / left / up / down", keys: ["Ctrl", "→ ← ↑ ↓"] },
      { label: "Close focused pane", keys: ["Ctrl", "W"] },
      { label: "Reset terminal mouse modes (focused)", keys: ["Ctrl", "Shift", "R"] },
    ],
  },
  {
    name: "Surfaces",
    rows: [
      { label: "Toggle Sidebar", keys: ["Ctrl", "B"] },
      { label: "Toggle MD Editor Full View", keys: ["Ctrl", "E"] },
      { label: "Toggle MD Quick Viewer", keys: ["Ctrl", "Shift", "M"] },
      { label: "Open .md file", keys: ["Ctrl", "O"] },
      { label: "Open Folder (workspace)", keys: ["Ctrl", "K", "Ctrl", "O"] },
      { label: "Show keyboard shortcuts", keys: ["Ctrl", "?"] },
    ],
  },
  {
    name: "MD Editor",
    rows: [
      { label: "Save", keys: ["Ctrl", "S"] },
      { label: "Cycle MD Editor tabs", keys: ["Ctrl", "Tab"] },
      { label: "Find in focused element", keys: ["Ctrl", "F"] },
      { label: "Find & replace", keys: ["Ctrl", "H"] },
      { label: "Find across all open MD tabs", keys: ["Ctrl", "Shift", "F"] },
    ],
  },
  {
    name: "Clipboard",
    rows: [
      { label: "Copy / paste (terminal pane)", keys: ["Ctrl", "Shift", "C / V"] },
      { label: "Copy / paste / cut (non-terminal)", keys: ["Ctrl", "C / V / X"] },
    ],
  },
  {
    name: "Font",
    rows: [
      { label: "Increase / decrease / reset font size", keys: ["Ctrl", "= / - / 0"] },
    ],
  },
];

export function ShortcutsModal() {
  const open = useShortcutsModalStore((s) => s.open);
  const close = useShortcutsModalStore((s) => s.closeModal);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, close]);

  if (!open) return null;

  return (
    <div
      className={styles.backdrop}
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-modal-title"
    >
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header} id="shortcuts-modal-title">
          Keyboard shortcuts
          <button
            className={styles.closeBtn}
            onClick={close}
            aria-label="Close shortcuts modal"
            title="Close (Esc)"
          >
            ×
          </button>
        </div>
        <div className={styles.body}>
          {CATALOG.map((group) => (
            <div key={group.name} className={styles.group}>
              <div className={styles.groupHeader}>{group.name}</div>
              {group.rows.map((row) => (
                <div key={row.label} className={styles.row}>
                  <span className={styles.label}>{row.label}</span>
                  <span className={styles.keys}>
                    {row.keys.map((k, i) => (
                      <kbd key={`${row.label}-${i}`} className={styles.key}>
                        {k}
                      </kbd>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Wire ⌨ TopBar button**

In `src/components/TopBar.tsx`, replace the ⌨ button's `console.info(...)` onClick with:

```tsx
import { useShortcutsModalStore } from "@/store/shortcutsModalStore";

// inside the component, remove the console.info inline:
onClick={() => useShortcutsModalStore.getState().openModal()}
```

- [ ] **Step 5: Add Ctrl+? shortcut**

In `src/hooks/useKeyboardShortcuts.ts`, add a helper and an entry:

```typescript
function openShortcutsModal(): boolean {
  useShortcutsModalStore.getState().openModal();
  return true;
}
```

Import: `import { useShortcutsModalStore } from "@/store/shortcutsModalStore";`

Add the entry near the other surface-toggle shortcuts (before Ctrl+W close-pane):
```typescript
  // Ctrl+? — opens the keyboard shortcuts viewer (DESIGN.md §7).
  // ? is Shift+/, so the modifier set is Ctrl+Shift and the key is "?" or "/".
  {
    match: (e) =>
      e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && (e.key === "?" || e.key === "/"),
    run: () => openShortcutsModal(),
  },
```

- [ ] **Step 6: Mount in App.tsx**

```tsx
import { ShortcutsModal } from "@/components/ShortcutsModal";
// ...
      <SplitMenu />
      <ShortcutsModal />
```

- [ ] **Step 7: Update TopBar test for the ⌨ button**

The existing TopBar tests assert the ⌨ button is rendered. They should still pass — the test doesn't check the onClick body. Confirm.

- [ ] **Step 8: Run the full suite**

```bash
npm run typecheck
npm test -- --run
cargo test --lib --manifest-path src-tauri/Cargo.toml
cargo clippy --all-targets --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check
```
Expected: 112 vitest (no new tests), 20 cargo, all gates green.

- [ ] **Step 9: Commit the Phase 3 bundle**

```bash
git add src/store/splitMenuStore.ts src/components/SplitMenu.tsx src/components/SplitMenu.module.css src/store/shortcutsModalStore.ts src/components/ShortcutsModal.tsx src/components/ShortcutsModal.module.css src/components/TopBar.tsx src/components/TopBar.test.tsx src/hooks/useKeyboardShortcuts.ts src/App.tsx
git commit -m "$(cat <<'EOF'
feat(topbar): Split menu popup + Shortcuts viewer modal

Two TopBar buttons that previously stubbed out:

1. ⊞ Split button now opens a small popup anchored under the button
   with three direction icons (→ ↑ ↓) per DESIGN.md §3. Click an icon
   to split the focused pane in that direction and close the popup.
   Click outside or press Esc to dismiss.

2. ⌨ Keyboard shortcuts button (and Ctrl+?) opens a read-only modal
   listing every shortcut from DESIGN.md §7 grouped by category (Panes,
   Surfaces, MD Editor, Clipboard, Font). Esc dismisses.

Stores: splitMenuStore (open + anchor coords), shortcutsModalStore
(open + openModal/closeModal/toggle). Both are tiny — no immer needed.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Phase 3 — Holistic review

- [ ] Dispatch reviewer with `git diff HEAD~1..HEAD`:
  - Split menu anchored correctly under the ⊞ button.
  - Click-outside-closes works.
  - Esc-closes works on both popups.
  - The CATALOG in ShortcutsModal matches DESIGN.md §7 row-for-row.
  - aria-modal, aria-labelledby, aria-label all present on the modal.

---

# Final post-finishing-touches review

After commit 34 lands:

- [ ] Dispatch one final code-reviewer subagent with `git diff HEAD~3..HEAD` and ask:
  - DESIGN.md §3 surfaces — every numbered item is now actually clickable.
  - DESIGN.md §7 — every listed shortcut is implemented AND shown in the viewer.
  - DESIGN.md §8 — toast severity colors and durations match.
  - DESIGN.md §1 invariant 3 — pane close with running process really shows the dialog.
  - Any new code patterns introduced (chord shortcuts, imperative confirm) — would a v0.2 maintainer pick them up easily?

---

# Verification command reference

Run after every commit:

```bash
npm run typecheck
npm test -- --run
cargo test --lib --manifest-path src-tauri/Cargo.toml
cargo clippy --all-targets --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check
```

All five green before any commit ships.

---

# What's NOT in this plan (and why)

Per the user's instruction: "Releases will be at the end of everything." This plan is product-only. Not in scope:

- Weekend 5 tests, CI workflow, MSI installer.
- 5 accent presets (the `[theme] accent` config field accepts them; UI is v0.2).
- Mica blur titlebar (Mac polish, v0.2).
- Spotlight Ctrl+K (v0.3 — note Ctrl+K is now claimed for the chord prefix; Spotlight needs a different binding or a chord conflict resolution when it lands).
- Dashboard view (v0.1.1 stub then v0.3 real fleet view per CEO-REVIEW.md).
- OSC 7 shell integration (v0.2 — would replace the is_pty_busy heuristic with something real).
- Drag-to-reorder MD tabs (v0.3).

Tracking these as known deferrals; none of them are required for v0.1's spec contract.

---

# Self-review checklist (controller signed off before saving)

- [x] Every task references exact file paths.
- [x] Every code step shows the actual code.
- [x] Test commands include exact `npm test` / `cargo test` invocations.
- [x] Commits bundled per phase (3 commits for this plan).
- [x] DESIGN.md §3, §7, §8 spec references included where they govern behavior.
- [x] DESIGN.md §1 invariant 3 (close-with-active-child confirm) explicitly addressed.
- [x] No release / CI work — that's saved for after the user calls the product done.
- [x] Verification gates listed at every phase boundary.
- [x] Phase-boundary holistic review dispatched after each.
- [x] Final cross-phase review at the end.
