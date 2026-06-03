# Drag-and-Drop File Attach Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user drag a file onto a terminal pane — from the in-app Toggle-files drawer (Phase 1) or from the OS file explorer (Phase 2) — and have its path bracketed-pasted into that pane's running agent (Claude Code / Codex) without a trailing newline, so they keep prompting.

**Architecture:** Both drag sources converge on one primitive: `pasteFileToPane(paneId, filePath)`, which resolves the owning session's folder, formats the path (session-relative if the file lives under the folder, else absolute; quoted if it contains spaces), and calls `getOrCreateTerminal(paneId).paste(text)` — the existing onData→PTY wire (registry.ts:86) that already handles bracketed-paste. The drop target highlights via a tiny shared `dropTargetStore` so both the internal DOM drag and the external Tauri drag light up the same pane. Internal drags use HTML5 DnD with a private MIME type; external OS drops use Tauri v2's `onDragDropEvent` and hit-test the drop position against `[data-pane-id]`.

**Tech Stack:** React 18 + TypeScript + Zustand + Immer (existing). xterm.js `term.paste()` (existing paste wire). `@tauri-apps/api/webview` `getCurrentWebview().onDragDropEvent` (already available — no new dependency, `dragDropEnabled` defaults to `true`). Vitest for the pure-logic tests.

**Scope (locked — do not deviate):**
- Two sources: Toggle-files drawer rows (Phase 1) + OS Explorer (Phase 2).
- Path format: session-relative when the file is under the session folder, else absolute; quote if it contains whitespace; **never append a newline**; route through `term.paste()` so bracketed-paste mode is respected.
- Drop-target pane highlights on drag-over.
- Any file type (images included — we paste the path; the agent reads the file).
- **Deferred / NOT in this plan:** multi-file drop (Phase 2 pastes the first path and toasts if more were dropped), OSC-7 true-shell-pwd-relative paths, in-app "mount external folder" browsing.

---

## File structure delivered by this plan

### New files
| Path | Responsibility |
|---|---|
| `src/lib/attachPath.ts` | Pure path formatting: `relativeUnder`, `quoteIfNeeded`, `formatAttachPath`, and the private MIME constant `WORKSTATION_FILE_MIME`. No I/O. |
| `src/lib/attachPath.test.ts` | Vitest coverage for the path formatter across Windows paths, spaces, under/not-under folder, null folder, trailing slashes. |
| `src/lib/pasteFileToPane.ts` | The shared primitive: resolve session folder → format → `term.paste()` → focus pane. |
| `src/lib/pasteFileToPane.test.ts` | Vitest: mocks the registry + drives sessionsStore state; asserts the formatted text reaches `term.paste`. |
| `src/store/dropTargetStore.ts` | Zustand slice holding the single highlighted `paneId` during a drag. |
| `src/store/dropTargetStore.test.ts` | Vitest: set / clear. |
| `src/hooks/useExternalFileDrop.ts` | Subscribes to Tauri `onDragDropEvent`; hit-tests position → pane; pastes external paths (Phase 2). |

### Modified files
| Path | Change |
|---|---|
| `src/components/TerminalPane.tsx` | Add `data-pane-id` to the wrapper; `onDragOver`/`onDragLeave`/`onDrop` for internal file drags; subscribe to `dropTargetStore` and render a highlight overlay when this pane is the drop target. |
| `src/components/SidebarRow.tsx` | Accept optional `draggable` + `onDragStart` props and spread them onto the row `<div>`. |
| `src/components/SidebarTree.tsx` | Make file (non-dir) rows draggable; `onDragStart` writes the path to the dataTransfer under `WORKSTATION_FILE_MIME`. |
| `src/App.tsx` | Mount `useExternalFileDrop()` (Phase 2). |

---

## Process notes for the executing controller
- **Two phases**, each ending in one bundle commit + a holistic review.
- **Verification gates at each phase boundary — all five must be green:** `npm test -- --run`, `npm run typecheck`, `cargo test --lib --manifest-path src-tauri/Cargo.toml`, `cargo clippy --all-targets --manifest-path src-tauri/Cargo.toml -- -D warnings`, `cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check`. (No Rust changes in this plan — the cargo gates should stay unchanged; run them anyway to prove it.)
- **No release/CI work.**

---

# Phase 1 — Internal drag: Toggle-files drawer → terminal

## Task 1.1: Path formatter (pure, TDD)

**Files:**
- Create: `src/lib/attachPath.ts`
- Test: `src/lib/attachPath.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/attachPath.test.ts
import { describe, it, expect } from "vitest";
import {
  relativeUnder,
  quoteIfNeeded,
  formatAttachPath,
  WORKSTATION_FILE_MIME,
} from "@/lib/attachPath";

describe("relativeUnder", () => {
  it("returns a forward-slash relative path when file is under the folder", () => {
    expect(relativeUnder("C:\\proj\\src\\auth.ts", "C:\\proj")).toBe("src/auth.ts");
  });
  it("is case-insensitive on the folder prefix (Windows)", () => {
    expect(relativeUnder("C:\\Proj\\a.ts", "c:\\proj")).toBe("a.ts");
  });
  it("tolerates a trailing slash on the folder", () => {
    expect(relativeUnder("C:\\proj\\a.ts", "C:\\proj\\")).toBe("a.ts");
  });
  it("returns null when the file is not under the folder", () => {
    expect(relativeUnder("D:\\other\\a.ts", "C:\\proj")).toBeNull();
  });
  it("returns null when file equals folder", () => {
    expect(relativeUnder("C:\\proj", "C:\\proj")).toBeNull();
  });
});

describe("quoteIfNeeded", () => {
  it("quotes paths containing whitespace", () => {
    expect(quoteIfNeeded("C:\\my files\\a.ts")).toBe('"C:\\my files\\a.ts"');
  });
  it("leaves space-free paths untouched", () => {
    expect(quoteIfNeeded("src/a.ts")).toBe("src/a.ts");
  });
});

describe("formatAttachPath", () => {
  it("relativizes when under the session folder", () => {
    expect(formatAttachPath("C:\\proj\\src\\a.ts", "C:\\proj")).toBe("src/a.ts");
  });
  it("falls back to the absolute path when not under the folder", () => {
    expect(formatAttachPath("D:\\ext\\spec.md", "C:\\proj")).toBe("D:\\ext\\spec.md");
  });
  it("uses the absolute path when no session folder is known", () => {
    expect(formatAttachPath("D:\\ext\\spec.md", null)).toBe("D:\\ext\\spec.md");
  });
  it("quotes a relativized path that contains spaces", () => {
    expect(formatAttachPath("C:\\proj\\my dir\\a.ts", "C:\\proj")).toBe('"my dir/a.ts"');
  });
});

describe("WORKSTATION_FILE_MIME", () => {
  it("is a private vendor MIME type", () => {
    expect(WORKSTATION_FILE_MIME).toBe("application/x-workstation-file");
  });
});
```

- [ ] **Step 2: Run — expect FAIL ("Cannot find module @/lib/attachPath")**

Run: `npm test -- --run src/lib/attachPath.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the formatter**

```typescript
// src/lib/attachPath.ts
//
// Pure path formatting for drag-and-drop file attach. No I/O. Turns an
// absolute filesystem path into the string we paste into a terminal:
//   - relative to the session folder when the file lives under it (shorter,
//     and it's what an agent already-rooted there expects),
//   - otherwise the absolute path (the external-file case),
//   - quoted when it contains whitespace.
// Separators in the relativized result are normalized to "/" — Claude Code and
// Codex both accept forward slashes on Windows, and it sidesteps escaping.

/** Private vendor MIME type for in-app file drags (sidebar row → pane). */
export const WORKSTATION_FILE_MIME = "application/x-workstation-file";

function normalizeForCompare(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/** The path of `filePath` relative to `folder`, forward-slashed, or null when
 *  `filePath` is not strictly inside `folder`. */
export function relativeUnder(filePath: string, folder: string): string | null {
  const folderNorm = normalizeForCompare(folder);
  const fileFwd = filePath.replace(/\\/g, "/");
  const fileLower = fileFwd.toLowerCase().replace(/\/+$/, "");
  if (fileLower === folderNorm) return null;
  const prefix = folderNorm + "/";
  if (!fileLower.startsWith(prefix)) return null;
  return fileFwd.slice(prefix.length);
}

/** Double-quote the path if it contains any whitespace. */
export function quoteIfNeeded(p: string): string {
  return /\s/.test(p) ? `"${p}"` : p;
}

/** The string to paste into a terminal for `filePath`, given the owning
 *  session's folder (or null when unknown). */
export function formatAttachPath(filePath: string, sessionFolder: string | null): string {
  const rel = sessionFolder ? relativeUnder(filePath, sessionFolder) : null;
  return quoteIfNeeded(rel ?? filePath);
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npm test -- --run src/lib/attachPath.test.ts`
Expected: all green.

- [ ] **Step 5: Commit (deferred — bundles with Phase 1)**

---

## Task 1.2: Drop-target store (TDD)

**Files:**
- Create: `src/store/dropTargetStore.ts`
- Test: `src/store/dropTargetStore.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/store/dropTargetStore.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { useDropTargetStore } from "@/store/dropTargetStore";

describe("dropTargetStore", () => {
  beforeEach(() => useDropTargetStore.getState().setDropTarget(null));

  it("starts with no drop target", () => {
    expect(useDropTargetStore.getState().paneId).toBeNull();
  });
  it("sets and clears the highlighted pane", () => {
    useDropTargetStore.getState().setDropTarget("pane-3");
    expect(useDropTargetStore.getState().paneId).toBe("pane-3");
    useDropTargetStore.getState().setDropTarget(null);
    expect(useDropTargetStore.getState().paneId).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npm test -- --run src/store/dropTargetStore.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the store**

```typescript
// src/store/dropTargetStore.ts
//
// Which pane is currently the drag-and-drop target. Shared so the internal
// DOM drag (sidebar row → pane) and the external Tauri OS drop both highlight
// the same pane through one render path. Transient UI state — never persisted.

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { PaneId } from "@/types";

interface DropTargetState {
  paneId: PaneId | null;
  setDropTarget: (id: PaneId | null) => void;
}

export const useDropTargetStore = create<DropTargetState>()(
  devtools(
    (set) => ({
      paneId: null,
      setDropTarget: (id) => set({ paneId: id }),
    }),
    { name: "dropTargetStore" }
  )
);
```

- [ ] **Step 4: Run — expect PASS**

Run: `npm test -- --run src/store/dropTargetStore.test.ts`
Expected: green.

- [ ] **Step 5: Commit (deferred)**

---

## Task 1.3: The shared `pasteFileToPane` primitive (TDD)

**Files:**
- Create: `src/lib/pasteFileToPane.ts`
- Test: `src/lib/pasteFileToPane.test.ts`

- [ ] **Step 1: Write the failing test (mock the registry + drive store state)**

```typescript
// src/lib/pasteFileToPane.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";

const paste = vi.fn();
const focusTerminal = vi.fn();
vi.mock("@/terminals/registry", () => ({
  getOrCreateTerminal: () => ({ paste }),
  focusTerminal,
}));

import { pasteFileToPane } from "@/lib/pasteFileToPane";
import { useSessionsStore } from "@/store/sessionsStore";
import { useLayoutStore } from "@/store/layoutStore";

describe("pasteFileToPane", () => {
  beforeEach(() => {
    paste.mockClear();
    focusTerminal.mockClear();
    useSessionsStore.getState().reset();
  });

  it("pastes a session-relative path for a file under the session folder", () => {
    // Seed a session whose layout owns pane-7, rooted at C:\proj.
    const id = useSessionsStore.getState().createSession("C:\\proj", "s");
    useSessionsStore.getState().setLayoutRoot(id, { type: "leaf", paneId: "pane-7" });

    pasteFileToPane("pane-7", "C:\\proj\\src\\auth.ts");

    expect(paste).toHaveBeenCalledWith("src/auth.ts");
    expect(focusTerminal).toHaveBeenCalledWith("pane-7");
  });

  it("pastes the absolute path when the pane has no owning session", () => {
    pasteFileToPane("pane-99", "D:\\ext\\spec.md");
    expect(paste).toHaveBeenCalledWith("D:\\ext\\spec.md");
  });
});
```

> **Implementer note:** confirm `LayoutNode`'s leaf shape is `{ type: "leaf", paneId }` by reading `src/store/layout/tree.ts`; adjust the seed object if the field names differ. `useLayoutStore` is imported only to keep the focus-call path realistic — `focusPane` is a no-op for an unknown pane and must not throw.

- [ ] **Step 2: Run — expect FAIL**

Run: `npm test -- --run src/lib/pasteFileToPane.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```typescript
// src/lib/pasteFileToPane.ts
//
// The one primitive both drag sources call. Resolves the pane's owning session
// folder, formats the path (attachPath), and routes it through the terminal's
// paste() — which goes onData → PTY with bracketed-paste handling (registry.ts).
// No trailing newline: the path lands at the prompt and the user keeps typing.

import { formatAttachPath } from "@/lib/attachPath";
import { getOrCreateTerminal, focusTerminal } from "@/terminals/registry";
import { useLayoutStore } from "@/store/layoutStore";
import { useSessionsStore, findSessionForPane } from "@/store/sessionsStore";
import type { PaneId } from "@/types";

export function pasteFileToPane(paneId: PaneId, filePath: string): void {
  const session = findSessionForPane(useSessionsStore.getState(), paneId);
  const folder = session?.folderPath ?? null;
  const text = formatAttachPath(filePath, folder);
  getOrCreateTerminal(paneId).paste(text);
  useLayoutStore.getState().focusPane(paneId);
  focusTerminal(paneId);
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npm test -- --run src/lib/pasteFileToPane.test.ts`
Expected: green.

- [ ] **Step 5: Commit (deferred)**

---

## Task 1.4: Make terminal panes drop targets

**Files:**
- Modify: `src/components/TerminalPane.tsx`

- [ ] **Step 1: Add imports**

At the top of `src/components/TerminalPane.tsx`, alongside the existing imports, add:

```typescript
import { useState, type DragEvent as ReactDragEvent } from "react";
import { useDropTargetStore } from "@/store/dropTargetStore";
import { pasteFileToPane } from "@/lib/pasteFileToPane";
import { WORKSTATION_FILE_MIME } from "@/lib/attachPath";
```

> **Implementer note:** `useState` may need to be merged into the existing `import { memo, useEffect, useRef, ... } from "react"` line rather than a second `react` import. Keep one import line per module.

- [ ] **Step 2: Subscribe to the drop-target highlight inside `TerminalPaneImpl`**

Just below `const hostRef = useRef<HTMLDivElement | null>(null);` add:

```typescript
  const isDropTarget = useDropTargetStore((s) => s.paneId === paneId);
  // Local flag mirrors the store but lets dragLeave clear instantly without a
  // store round-trip for the internal-drag case.
  const [, setDragging] = useState(false);

  const onDragOver = (e: ReactDragEvent<HTMLDivElement>) => {
    if (!e.dataTransfer.types.includes(WORKSTATION_FILE_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    setDragging(true);
    useDropTargetStore.getState().setDropTarget(paneId);
  };
  const onDragLeave = () => {
    setDragging(false);
    if (useDropTargetStore.getState().paneId === paneId) {
      useDropTargetStore.getState().setDropTarget(null);
    }
  };
  const onDrop = (e: ReactDragEvent<HTMLDivElement>) => {
    const path = e.dataTransfer.getData(WORKSTATION_FILE_MIME);
    setDragging(false);
    useDropTargetStore.getState().setDropTarget(null);
    if (!path) return;
    e.preventDefault();
    pasteFileToPane(paneId, path);
  };
```

- [ ] **Step 3: Wire the handlers + `data-pane-id` + highlight overlay onto the wrapper**

Replace the returned wrapper `<div onMouseDown={onMouseDown} onContextMenu={onContextMenu} style={{...}}>` opening tag and its inner host div with:

```tsx
    <div
      data-pane-id={paneId}
      onMouseDown={onMouseDown}
      onContextMenu={onContextMenu}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        padding: 6,
        background: "var(--bg-0)",
        boxSizing: "border-box",
      }}
    >
      <div ref={hostRef} style={{ width: "100%", height: "100%" }} />
      {isDropTarget && (
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            border: "2px solid var(--accent)",
            background: "color-mix(in srgb, var(--accent) 10%, transparent)",
            boxSizing: "border-box",
            zIndex: 3,
          }}
        />
      )}
    </div>
```

> **Implementer note:** `color-mix` is supported in WebView2 (Chromium ≥111). If the project's CSS elsewhere avoids it, fall back to `background: "var(--bg-2)"` with `opacity` — but `color-mix` is fine here.

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 5: Commit (deferred)**

---

## Task 1.5: Make Toggle-files drawer rows draggable

**Files:**
- Modify: `src/components/SidebarRow.tsx`
- Modify: `src/components/SidebarTree.tsx`

- [ ] **Step 1: Extend `SidebarRow` props**

In `src/components/SidebarRow.tsx`, add two optional props to the `Props` interface:

```typescript
  draggable?: boolean;
  onDragStart?: (e: ReactDragEvent<HTMLDivElement>) => void;
```

Add the `DragEvent` type to the existing react type import:

```typescript
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from "react";
```

Destructure the new props in the function signature (`draggable`, `onDragStart`) and spread them onto the row `<div>`:

```tsx
    <div
      className={rowClass}
      style={{ paddingLeft: indent }}
      onClick={onClick}
      onContextMenu={onContextMenu}
      draggable={draggable}
      onDragStart={onDragStart}
    >
```

- [ ] **Step 2: Set up the drag in `SidebarTree`**

In `src/components/SidebarTree.tsx`, add the MIME import:

```typescript
import { WORKSTATION_FILE_MIME } from "@/lib/attachPath";
```

Add the `DragEvent` type to the existing react import:

```typescript
import { useEffect, type DragEvent as ReactDragEvent, type MouseEvent as ReactMouseEvent } from "react";
```

Inside the `.map((entry) => { ... })` body, after `onContextMenu` is computed, add:

```typescript
          // Files are draggable onto a terminal pane (drag-drop file attach).
          // Directories are not — you attach files, not folders.
          const onDragStart = entry.is_dir
            ? undefined
            : (e: ReactDragEvent<HTMLDivElement>) => {
                e.dataTransfer.setData(WORKSTATION_FILE_MIME, entry.path);
                e.dataTransfer.effectAllowed = "copy";
              };
```

Then pass them to `SidebarRow`:

```tsx
              <SidebarRow
                name={entry.name}
                isDir={entry.is_dir}
                depth={depth}
                expanded={isExpanded}
                selected={false}
                dimmed={dimmed}
                onClick={onClick}
                onContextMenu={onContextMenu}
                draggable={!entry.is_dir}
                onDragStart={onDragStart}
              />
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 4: Run the full suite + all gates**

```bash
npm test -- --run
npm run typecheck
cargo test --lib --manifest-path src-tauri/Cargo.toml
cargo clippy --all-targets --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check
```

Expected: vitest green with the new attachPath / dropTargetStore / pasteFileToPane tests; typecheck clean; cargo unchanged and green.

- [ ] **Step 5: Manual smoke (dev build)**

Run `npm run tauri dev`. Open the Toggle-files drawer (Ctrl+Shift+E), start an agent in a pane, drag a file from the drawer over the pane (it highlights), drop it (the path appears at the prompt, no Enter fired), and confirm a file in a subfolder pastes as a session-relative path.

- [ ] **Step 6: Commit the Phase 1 bundle**

```bash
git add src/lib/attachPath.ts src/lib/attachPath.test.ts src/lib/pasteFileToPane.ts src/lib/pasteFileToPane.test.ts src/store/dropTargetStore.ts src/store/dropTargetStore.test.ts src/components/TerminalPane.tsx src/components/SidebarRow.tsx src/components/SidebarTree.tsx
git commit -m "$(cat <<'EOF'
feat(dnd): drag a file from the Toggle-files drawer onto a terminal

Dragging a file row onto a terminal pane bracketed-pastes its path into
the running agent (Claude Code / Codex) with no trailing newline, so you
keep prompting. Path is session-relative when the file lives under the
session folder, else absolute; quoted if it contains spaces. Drop target
pane highlights on drag-over via a shared dropTargetStore.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Phase 1 — Holistic review

- [ ] Dispatch a code-reviewer subagent over `git diff HEAD~1..HEAD`:
  - The pasted text never contains a trailing newline; it routes through `term.paste()` (not `writePty`), so bracketed-paste mode is honored.
  - `formatAttachPath` relativizes only when the file is strictly under the session folder; case-insensitive prefix match for Windows.
  - The drop overlay uses theme tokens (`--accent`), not raw hex, and is `pointer-events: none`.
  - `data-pane-id` is on the same wrapper that owns the drop handlers (needed by Phase 2 hit-testing).
  - Directories are NOT draggable; only files set the dataTransfer payload.
  - `dragLeave` only clears the store when this pane is the current target (no cross-pane clobber).

---

# Phase 2 — External drag: OS Explorer → terminal

**Why separate:** OS file drops don't surface as HTML5 `drop` events in the webview — Tauri v2 intercepts them (`dragDropEnabled` defaults to `true`) and emits `tauri://drag-drop` events with absolute paths. We hit-test the physical drop position against `[data-pane-id]` (added in Phase 1) and reuse `pasteFileToPane`.

## Task 2.1: External-drop hook (Tauri `onDragDropEvent`)

**Files:**
- Create: `src/hooks/useExternalFileDrop.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1: Write the hook**

```typescript
// src/hooks/useExternalFileDrop.ts
//
// Bridges OS file drops (drag from Windows Explorer) into the terminal-attach
// primitive. Tauri v2 intercepts native file drops (dragDropEnabled defaults
// true) and emits position + absolute paths via onDragDropEvent — the webview
// never sees an HTML5 drop for OS files, so this is the only path for them.
//
// The event position is PHYSICAL pixels; elementFromPoint wants CSS pixels, so
// we divide by devicePixelRatio. We hit-test against [data-pane-id] (set on the
// TerminalPane wrapper in Phase 1) to find the target pane.
//
// Multi-file is deferred: we attach the FIRST path and toast if more were
// dropped, so nothing is silently lost.

import { useEffect } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";

import { useDropTargetStore } from "@/store/dropTargetStore";
import { pasteFileToPane } from "@/lib/pasteFileToPane";
import { useToastStore } from "@/store/toastStore";
import type { PaneId } from "@/types";

function paneIdAtPhysical(x: number, y: number): PaneId | null {
  const dpr = window.devicePixelRatio || 1;
  const el = document.elementFromPoint(x / dpr, y / dpr);
  const host = (el?.closest("[data-pane-id]") as HTMLElement | null) ?? null;
  return (host?.dataset.paneId as PaneId | undefined) ?? null;
}

export function useExternalFileDrop(): void {
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;

    void getCurrentWebview()
      .onDragDropEvent((event) => {
        const p = event.payload;
        if (p.type === "over") {
          useDropTargetStore.getState().setDropTarget(paneIdAtPhysical(p.position.x, p.position.y));
          return;
        }
        if (p.type === "drop") {
          const paneId = paneIdAtPhysical(p.position.x, p.position.y);
          useDropTargetStore.getState().setDropTarget(null);
          if (!paneId || p.paths.length === 0) return;
          pasteFileToPane(paneId, p.paths[0]);
          if (p.paths.length > 1) {
            useToastStore.getState().push({
              severity: "info",
              message: `Attached the first of ${p.paths.length} files (multi-file drop isn't supported yet).`,
            });
          }
          return;
        }
        // "leave" (and any other) — clear the highlight.
        useDropTargetStore.getState().setDropTarget(null);
      })
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      });

    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, []);
}
```

> **Implementer note:** the `event.payload` discriminated union (`"enter" | "over" | "drop" | "leave"`) comes from `@tauri-apps/api/webview`. `over`/`drop` carry `position`; `drop`/`enter` carry `paths`. If TypeScript narrows differently in the installed version, read `node_modules/@tauri-apps/api/webview.d.ts` for the exact member names and adjust — do NOT cast to `any`.

- [ ] **Step 2: Mount the hook in `App.tsx`**

Add the import:

```typescript
import { useExternalFileDrop } from "@/hooks/useExternalFileDrop";
```

Inside `App()`, next to `useKeyboardShortcuts();`, add:

```typescript
  useExternalFileDrop();
```

- [ ] **Step 3: Typecheck + all gates**

```bash
npm run typecheck
npm test -- --run
cargo test --lib --manifest-path src-tauri/Cargo.toml
cargo clippy --all-targets --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check
```

Expected: all green (no test count change — the hook is verified by manual smoke).

- [ ] **Step 4: Manual smoke (dev build)**

Run `npm run tauri dev`. Drag an image (e.g. a screenshot) and a `.md` file from Windows Explorer onto a pane running Claude Code: the pane highlights on drag-over, and on drop the absolute path appears at the prompt (no Enter). Confirm an external file pastes as an absolute path. Drop two files at once → first attaches, info toast names the count.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useExternalFileDrop.ts src/App.tsx
git commit -m "$(cat <<'EOF'
feat(dnd): drag a file from OS Explorer onto a terminal

Tauri onDragDropEvent → hit-test the drop position against [data-pane-id]
→ pasteFileToPane with the absolute path. Reuses the Phase 1 primitive and
highlight. Multi-file deferred: attaches the first path, toasts the count.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Phase 2 — Holistic review

- [ ] Dispatch a reviewer over `git diff HEAD~1..HEAD`:
  - Physical→CSS pixel conversion divides by `devicePixelRatio`; hit-test walks up to `[data-pane-id]`.
  - The `onDragDropEvent` listener is unlistened on unmount, and the `disposed` guard handles the async-resolve-after-unmount race.
  - External drops paste the ABSOLUTE path (external files aren't under the session folder, so `formatAttachPath` returns it unchanged) — verify by reading the toast/no-toast path.
  - No `any` casts on the Tauri payload.

---

## Self-Review (run before handing off)

**Spec coverage:**
- Internal source (Toggle-files drawer → pane): Tasks 1.4–1.5. ✓
- External source (OS Explorer → pane): Task 2.1. ✓
- Session-relative-else-absolute + quote + no-newline + bracketed paste: Task 1.1 + 1.3. ✓
- Drop-target highlight: Task 1.2 + 1.4 (+ reused in 2.1). ✓
- Any file type incl. images: paths only — type-agnostic by construction. ✓
- Deferred multi-file: Task 2.1 attaches first + toasts. ✓

**Placeholder scan:** every code step contains full code; commands have expected output. ✓

**Type consistency:** `WORKSTATION_FILE_MIME`, `formatAttachPath`, `pasteFileToPane`, `useDropTargetStore.setDropTarget`, `paneIdAtPhysical` referenced with consistent signatures across tasks. ✓
