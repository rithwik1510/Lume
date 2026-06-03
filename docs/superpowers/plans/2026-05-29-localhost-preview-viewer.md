# Localhost Preview Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A resizable right-docked panel — a sibling to the MD Quick Viewer — that renders a localhost URL in an `<iframe>`, so when an agent is building a frontend the user sees the running app inside the Workstation instead of alt-tabbing to a browser.

**Architecture:** Mirror the existing Quick Viewer exactly: a new `previewStore` (open / url / reloadNonce), a `Preview` component (header with editable URL bar + reload + open-external + close, body is an `<iframe key={reloadNonce}>`), and an extra optional `Panel` + `PanelResizeHandle` in `App.tsx`'s central horizontal `PanelGroup`. Toggled by a new TopBar button and Ctrl+Shift+L, the same pattern as the Quick Viewer's button + Ctrl+Shift+M. URL entry is normalized (`3000` → `http://localhost:3000`). An "open in external browser" escape hatch (via `@tauri-apps/plugin-shell`'s `open`) covers dev servers that refuse to be iframed (`X-Frame-Options`/CSP). The app CSP is already `null`, so iframing localhost is unrestricted.

**Tech Stack:** React 18 + TypeScript + Zustand (existing). `react-resizable-panels` (already used for the Quick Viewer dock). `@tauri-apps/plugin-shell` `open` (already a dependency; capability addition below). Vitest for the URL normalizer + store.

**Scope (locked — do not deviate):**
- One right-docked, resizable preview panel hosting a localhost `<iframe>`.
- Editable URL bar (Enter to load), reload button, open-in-external-browser button, close button.
- URL normalization for bare ports / `localhost:port` / IPs.
- Toggle via TopBar button + Ctrl+Shift+L.
- **Deferred / NOT in this plan:** auto-detecting the dev-server URL from terminal output (the magic follow-on — a separate plan), per-session preview binding, devtools, persisting the URL across restarts.

---

## File structure delivered by this plan

### New files
| Path | Responsibility |
|---|---|
| `src/lib/normalizePreviewUrl.ts` | Pure: turn user input (`3000`, `localhost:5173`, `http://…`, `127.0.0.1:8080`) into a loadable URL, or `null` for empty input. |
| `src/lib/normalizePreviewUrl.test.ts` | Vitest coverage of the normalizer. |
| `src/store/previewStore.ts` | Zustand slice: `open`, `url`, `reloadNonce` + `openPreview` / `closePreview` / `setUrl` / `reload` / `reset`. |
| `src/store/previewStore.test.ts` | Vitest: open/close, setUrl, reload bumps nonce. |
| `src/lib/openExternal.ts` | Thin wrapper over `@tauri-apps/plugin-shell` `open`, kept mockable. |
| `src/components/Preview.tsx` | The panel: header (URL bar + reload + external + close) and the `<iframe>` body. |
| `src/components/Preview.module.css` | Panel styling, mirroring `QuickViewer.module.css` tokens. |

### Modified files
| Path | Change |
|---|---|
| `src/components/icons.tsx` | Add an `IconGlobe` stroke SVG for the toggle button. |
| `src/components/TopBar.tsx` | Add a Preview toggle button on the right cluster (before the Quick Viewer eye), wired to `previewStore`. |
| `src/hooks/useKeyboardShortcuts.ts` | Add a Ctrl+Shift+L binding that toggles the preview (mirrors the Ctrl+Shift+M Quick Viewer toggle). |
| `src/App.tsx` | Add the optional Preview `Panel` + `PanelResizeHandle` to the central `PanelGroup`; recompute panel default sizes for the MainArea / Quick Viewer / Preview combinations; key the group on the open-set. |
| `src-tauri/capabilities/default.json` | Ensure `shell:allow-open` so `open(url)` is permitted (verify `shell:default` doesn't already cover it before adding). |

---

## Process notes for the executing controller
- **One phase**, ending in a single bundle commit + holistic review. (Auto-detect-from-output is a future, separate plan.)
- **Verification gates — all five green:** `npm test -- --run`, `npm run typecheck`, `cargo test --lib --manifest-path src-tauri/Cargo.toml`, `cargo clippy --all-targets --manifest-path src-tauri/Cargo.toml -- -D warnings`, `cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check`.

---

## Task 1: URL normalizer (pure, TDD)

**Files:**
- Create: `src/lib/normalizePreviewUrl.ts`
- Test: `src/lib/normalizePreviewUrl.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/normalizePreviewUrl.test.ts
import { describe, it, expect } from "vitest";
import { normalizePreviewUrl } from "@/lib/normalizePreviewUrl";

describe("normalizePreviewUrl", () => {
  it("returns null for empty / whitespace input", () => {
    expect(normalizePreviewUrl("")).toBeNull();
    expect(normalizePreviewUrl("   ")).toBeNull();
  });
  it("treats a bare port as localhost", () => {
    expect(normalizePreviewUrl("3000")).toBe("http://localhost:3000");
  });
  it("prefixes http:// onto localhost:port", () => {
    expect(normalizePreviewUrl("localhost:5173")).toBe("http://localhost:5173");
  });
  it("leaves an explicit http/https URL untouched", () => {
    expect(normalizePreviewUrl("http://localhost:8080/app")).toBe("http://localhost:8080/app");
    expect(normalizePreviewUrl("https://localhost:8443")).toBe("https://localhost:8443");
  });
  it("prefixes http:// onto an IP:port", () => {
    expect(normalizePreviewUrl("127.0.0.1:8080")).toBe("http://127.0.0.1:8080");
  });
  it("trims surrounding whitespace", () => {
    expect(normalizePreviewUrl("  3000 ")).toBe("http://localhost:3000");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npm test -- --run src/lib/normalizePreviewUrl.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```typescript
// src/lib/normalizePreviewUrl.ts
//
// Turn what a user types into the preview URL bar into a loadable URL.
//   ""            -> null   (nothing to load)
//   "3000"        -> http://localhost:3000
//   "localhost:5173" / "127.0.0.1:8080" / "host/path" -> http:// prefixed
//   "http(s)://…" -> unchanged
// Defaults to http:// because local dev servers almost never use TLS.

export function normalizePreviewUrl(input: string): string | null {
  const t = input.trim();
  if (t === "") return null;
  if (/^https?:\/\//i.test(t)) return t;
  if (/^\d{2,5}$/.test(t)) return `http://localhost:${t}`;
  return `http://${t}`;
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `npm test -- --run src/lib/normalizePreviewUrl.test.ts`
Expected: green.

- [ ] **Step 5: Commit (deferred — bundles with the rest)**

---

## Task 2: Preview store (TDD)

**Files:**
- Create: `src/store/previewStore.ts`
- Test: `src/store/previewStore.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/store/previewStore.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { usePreviewStore } from "@/store/previewStore";

describe("previewStore", () => {
  beforeEach(() => usePreviewStore.getState().reset());

  it("starts closed with no url", () => {
    const s = usePreviewStore.getState();
    expect(s.open).toBe(false);
    expect(s.url).toBe("");
  });
  it("openPreview opens and optionally sets the url", () => {
    usePreviewStore.getState().openPreview("http://localhost:3000");
    const s = usePreviewStore.getState();
    expect(s.open).toBe(true);
    expect(s.url).toBe("http://localhost:3000");
  });
  it("openPreview without a url keeps the existing url", () => {
    usePreviewStore.getState().setUrl("http://localhost:5173");
    usePreviewStore.getState().closePreview();
    usePreviewStore.getState().openPreview();
    expect(usePreviewStore.getState().url).toBe("http://localhost:5173");
    expect(usePreviewStore.getState().open).toBe(true);
  });
  it("reload bumps reloadNonce", () => {
    const before = usePreviewStore.getState().reloadNonce;
    usePreviewStore.getState().reload();
    expect(usePreviewStore.getState().reloadNonce).toBe(before + 1);
  });
  it("closePreview leaves the url intact for re-open", () => {
    usePreviewStore.getState().openPreview("http://localhost:3000");
    usePreviewStore.getState().closePreview();
    expect(usePreviewStore.getState().open).toBe(false);
    expect(usePreviewStore.getState().url).toBe("http://localhost:3000");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npm test -- --run src/store/previewStore.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```typescript
// src/store/previewStore.ts
//
// Localhost preview panel state. A sibling to the MD Quick Viewer (mdStore's
// quickViewer slice). `url` survives close so re-opening returns to the last
// address. `reloadNonce` is bumped to force the <iframe> to remount. Transient
// — not persisted in v1.

import { create } from "zustand";
import { devtools } from "zustand/middleware";

interface PreviewState {
  open: boolean;
  url: string;
  reloadNonce: number;
}
interface PreviewActions {
  openPreview: (url?: string) => void;
  closePreview: () => void;
  setUrl: (url: string) => void;
  reload: () => void;
  reset: () => void;
}
export type PreviewStore = PreviewState & PreviewActions;

const initial: PreviewState = { open: false, url: "", reloadNonce: 0 };

export const usePreviewStore = create<PreviewStore>()(
  devtools(
    (set) => ({
      ...initial,
      openPreview: (url) =>
        set((s) => ({ open: true, url: url ?? s.url })),
      closePreview: () => set({ open: false }),
      setUrl: (url) => set({ url }),
      reload: () => set((s) => ({ reloadNonce: s.reloadNonce + 1 })),
      reset: () => set({ ...initial }),
    }),
    { name: "previewStore" }
  )
);
```

- [ ] **Step 4: Run — expect PASS**

Run: `npm test -- --run src/store/previewStore.test.ts`
Expected: green.

- [ ] **Step 5: Commit (deferred)**

---

## Task 3: External-open wrapper

**Files:**
- Create: `src/lib/openExternal.ts`

- [ ] **Step 1: Write the wrapper**

```typescript
// src/lib/openExternal.ts
//
// Open a URL in the user's real default browser — the escape hatch for dev
// servers that refuse to be iframed (X-Frame-Options / frame-ancestors CSP).
// Thin so callers can mock it. Uses the shell plugin's opener.

import { open } from "@tauri-apps/plugin-shell";

export async function openExternal(url: string): Promise<void> {
  await open(url);
}
```

> **Implementer note:** confirm the import resolves — `@tauri-apps/plugin-shell` is already a dependency (README "Stack"). If the installed version exposes `open` from `@tauri-apps/plugin-opener` instead, switch the import accordingly and add `opener:default` to capabilities rather than `shell:allow-open`.

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 3: Commit (deferred)**

---

## Task 4: Capability for external open

**Files:**
- Modify: `src-tauri/capabilities/default.json`

- [ ] **Step 1: Verify whether it's already allowed**

`shell:default` is already in the permissions list. Check whether it grants `open`: run `npm run tauri dev`, open the preview (after Task 6) and click "open external" — if it works, SKIP the edit. If it errors with a permissions/scope rejection, do Step 2.

- [ ] **Step 2: Add the explicit permission (only if Step 1 rejected)**

In `src-tauri/capabilities/default.json`, append to the `permissions` array after `"shell:default"`:

```json
    "shell:allow-open",
```

> **Implementer note:** `shell:allow-open` permits the opener API. If the project pins the newer split crates and the JS import in Task 3 came from `@tauri-apps/plugin-opener`, use `"opener:default"` here and add `tauri-plugin-opener` registration in `src-tauri/src/lib.rs` — but try `shell:default`/`shell:allow-open` first since the shell plugin is already wired.

- [ ] **Step 3: Build check**

Run: `cargo build --manifest-path src-tauri/Cargo.toml`
Expected: clean.

- [ ] **Step 4: Commit (deferred)**

---

## Task 5: Globe icon + Preview component

**Files:**
- Modify: `src/components/icons.tsx`
- Create: `src/components/Preview.module.css`
- Create: `src/components/Preview.tsx`

- [ ] **Step 1: Add `IconGlobe` to `icons.tsx`**

Follow the existing custom-stroke-SVG convention (currentColor stroke, `size` prop). Add:

```tsx
export function IconGlobe({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18Z" />
    </svg>
  );
}
```

> **Implementer note:** match the existing export style in `icons.tsx` (named function vs const arrow). Read one neighbour (e.g. `IconEye`) and mirror it exactly.

- [ ] **Step 2: Write `Preview.module.css`**

```css
/* src/components/Preview.module.css
 * Mirrors QuickViewer.module.css — a right-docked panel with a header bar and
 * a flexed body. The body hosts an <iframe> that fills it. */

.root {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-0);
  border-left: 1px solid var(--border);
  box-sizing: border-box;
}

.header {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: 6px var(--space-2);
  border-bottom: 1px solid var(--border);
  background: var(--bg-1);
}

.urlInput {
  flex: 1;
  min-width: 0;
  height: 24px;
  background: var(--bg-0);
  color: var(--fg-0);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  padding: 0 8px;
  font-family: var(--font-mono);
  font-size: 12px;
}
.urlInput:focus {
  outline: none;
  border-color: var(--accent-dim);
}

.actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.iconButton {
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  color: var(--fg-2);
  cursor: pointer;
}
.iconButton:hover {
  color: var(--fg-0);
  background: var(--bg-2);
  border-color: var(--accent-dim);
}

.body {
  flex: 1;
  min-height: 0;
  position: relative;
}

.frame {
  width: 100%;
  height: 100%;
  border: 0;
  background: #ffffff; /* most dev servers render light; avoid a black flash */
}

.placeholder {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: var(--space-3);
  color: var(--fg-2);
  font-family: var(--font-ui);
  font-size: 13px;
}
```

- [ ] **Step 3: Write `Preview.tsx`**

```tsx
// src/components/Preview.tsx
//
// Localhost preview panel — a sibling to the MD Quick Viewer. Renders a
// localhost URL in an <iframe>. The iframe is keyed by reloadNonce so the
// reload button forces a fresh load. "Open external" is the escape hatch for
// dev servers that refuse to be iframed (X-Frame-Options / CSP).

import { useEffect, useState } from "react";

import styles from "@/components/Preview.module.css";
import { IconClose, IconGlobe } from "@/components/icons";
import { usePreviewStore } from "@/store/previewStore";
import { normalizePreviewUrl } from "@/lib/normalizePreviewUrl";
import { openExternal } from "@/lib/openExternal";
import { useToastStore } from "@/store/toastStore";

/** Lucide-style reload arrow. */
function IconReload({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

/** Lucide-style external-link. */
function IconExternal({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 3h6v6" />
      <path d="M10 14L21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}

export function Preview() {
  const url = usePreviewStore((s) => s.url);
  const reloadNonce = usePreviewStore((s) => s.reloadNonce);
  const setUrl = usePreviewStore((s) => s.setUrl);
  const reload = usePreviewStore((s) => s.reload);
  const closePreview = usePreviewStore((s) => s.closePreview);

  // Local draft so typing in the bar doesn't reload on every keystroke; commit
  // (normalize + store) on Enter or blur. Seeded from the store url.
  const [draft, setDraft] = useState(url);
  useEffect(() => setDraft(url), [url]);

  const commit = () => {
    const normalized = normalizePreviewUrl(draft);
    if (normalized === null) return;
    setUrl(normalized);
    setDraft(normalized);
  };

  const onExternal = () => {
    if (url === "") return;
    void openExternal(url).catch((err) => {
      useToastStore.getState().push({
        severity: "error",
        message: `Couldn't open externally: ${err instanceof Error ? err.message : String(err)}`,
      });
    });
  };

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <input
          className={styles.urlInput}
          type="text"
          value={draft}
          placeholder="localhost:3000"
          aria-label="Preview URL"
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
          onBlur={commit}
        />
        <div className={styles.actions}>
          <button className={styles.iconButton} title="Reload" aria-label="Reload preview" onClick={reload}>
            <IconReload />
          </button>
          <button
            className={styles.iconButton}
            title="Open in external browser"
            aria-label="Open in external browser"
            onClick={onExternal}
          >
            <IconExternal />
          </button>
          <button className={styles.iconButton} title="Close" aria-label="Close preview" onClick={closePreview}>
            <IconClose size={13} />
          </button>
        </div>
      </div>
      <div className={styles.body}>
        {url === "" ? (
          <div className={styles.placeholder}>
            Enter a localhost URL above (e.g. <code>3000</code> or <code>localhost:5173</code>) to preview your
            running app.
          </div>
        ) : (
          <iframe
            key={`${reloadNonce}:${url}`}
            className={styles.frame}
            src={url}
            title="Localhost preview"
          />
        )}
      </div>
    </div>
  );
}
```

> **Implementer note:** `IconGlobe` is imported here only if used; it's actually used in TopBar (Task 6). Keep the `Preview.tsx` import list to what it uses — remove `IconGlobe` from this file's import if unused to satisfy the no-unused-imports lint. (It's referenced above only via `icons` for the reload/external locals — those are defined inline, so `Preview.tsx` imports just `IconClose`. Adjust the import line to `import { IconClose } from "@/components/icons";`.)

- [ ] **Step 4: Fix the import line per the note**

Ensure `Preview.tsx`'s icon import is exactly:

```tsx
import { IconClose } from "@/components/icons";
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean (no unused imports).

- [ ] **Step 6: Commit (deferred)**

---

## Task 6: Toggle — TopBar button + Ctrl+Shift+L

**Files:**
- Modify: `src/components/TopBar.tsx`
- Modify: `src/hooks/useKeyboardShortcuts.ts`

- [ ] **Step 1: Import the store + icon in TopBar**

In `src/components/TopBar.tsx`, add `IconGlobe` to the icons import and add the store import:

```tsx
import { IconGlobe } from "@/components/icons"; // merge into the existing icons import list
import { usePreviewStore } from "@/store/previewStore";
```

- [ ] **Step 2: Read the open flag + handler in the component body**

Near the other store reads at the top of `TopBar()`:

```tsx
  const previewOpen = usePreviewStore((s) => s.open);
  const onTogglePreview = () => {
    const s = usePreviewStore.getState();
    if (s.open) s.closePreview();
    else s.openPreview();
  };
```

- [ ] **Step 3: Add the button to the right cluster**

In the `.right` cluster, immediately BEFORE the Quick Viewer eye button, add:

```tsx
        <button
          className={`${styles.btn} ${previewOpen ? styles.active : ""}`}
          title={previewOpen ? "Close Preview (Ctrl+Shift+L)" : "Open Preview (Ctrl+Shift+L)"}
          aria-label="Toggle Preview"
          data-tauri-drag-region="false"
          onClick={onTogglePreview}
        >
          <IconGlobe />
        </button>
```

> **Invariant:** `TopBar.test.tsx` asserts every clickable carries `data-tauri-drag-region="false"`; the new button has it, so the regression test stays green (control count +1).

- [ ] **Step 4: Add the Ctrl+Shift+L shortcut**

In `src/hooks/useKeyboardShortcuts.ts`, add a toggle helper next to `toggleQuickViewer` (around line 167):

```typescript
function togglePreview(): boolean {
  const s = usePreviewStore.getState();
  if (s.open) s.closePreview();
  else s.openPreview();
  return true;
}
```

Add the store import at the top of the file:

```typescript
import { usePreviewStore } from "@/store/previewStore";
```

Then add an entry to the `SHORTCUTS` array right after the Ctrl+Shift+M Quick Viewer entry (after line ~305):

```typescript
  // Toggle the localhost Preview panel — Ctrl+Shift+L.
  {
    match: (e) =>
      e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey && (e.key === "L" || e.key === "l"),
    run: () => togglePreview(),
  },
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 6: Commit (deferred)**

---

## Task 7: Dock the Preview panel in App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Import the Preview component + store**

```tsx
import { Preview } from "@/components/Preview";
import { usePreviewStore } from "@/store/previewStore";
```

- [ ] **Step 2: Read the open flag in `App()`**

Next to `const quickViewerOpen = useMdStore((s) => s.quickViewer.open);`:

```tsx
  const previewOpen = usePreviewStore((s) => s.open);
```

- [ ] **Step 3: Replace the central `PanelGroup` block**

Replace the existing `<PanelGroup direction="horizontal" id="pg-root-h"> … </PanelGroup>` (the `mdMode !== "full"` branch) with the version below. It adds the optional Preview panel, computes default sizes that sum to 100 for each open-set, and keys the group on the open-set so sizes re-init cleanly when panels appear/disappear:

```tsx
            <PanelGroup
              direction="horizontal"
              id="pg-root-h"
              key={`pg-root-${quickViewerOpen ? 1 : 0}-${previewOpen ? 1 : 0}`}
            >
              <Panel
                defaultSize={
                  quickViewerOpen && previewOpen
                    ? 45
                    : previewOpen
                      ? 55
                      : quickViewerOpen
                        ? 75
                        : 100
                }
                minSize={40}
              >
                <MainArea />
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
              {previewOpen && (
                <>
                  <PanelResizeHandle
                    onDragging={(isDragging) => {
                      if (isDragging) beginResize();
                      else endResize();
                    }}
                    style={{ width: 3, background: "var(--border)", cursor: "col-resize" }}
                  />
                  <Panel defaultSize={quickViewerOpen ? 30 : 45} minSize={25} maxSize={70}>
                    <Preview />
                  </Panel>
                </>
              )}
            </PanelGroup>
```

> **Implementer note:** default sizes per open-set sum to 100 (both: 45+25+30; preview-only: 55+45; qv-only: 75+25; neither: 100). The `key` forces a remount when the open-set changes so `react-resizable-panels` applies the fresh defaults instead of stale uncontrolled sizes — the same reason the file keeps the tree as the source of truth (see PaneTree header comment). The Preview handle reuses the `beginResize`/`endResize` gate so dragging it doesn't trigger the WebGL canvas-clear flicker on terminals in MainArea.

- [ ] **Step 4: Typecheck + full suite + all gates**

```bash
npm run typecheck
npm test -- --run
cargo test --lib --manifest-path src-tauri/Cargo.toml
cargo clippy --all-targets --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check
```

Expected: vitest green with new normalizePreviewUrl + previewStore tests; typecheck clean; cargo unchanged/green. `TopBar.test.tsx` drag-region invariant still passes (new button has the attribute).

- [ ] **Step 5: Manual smoke (dev build)**

Run `npm run tauri dev`. In a pane, start a dev server (e.g. `npm run dev` in a Vite/Next project). Press Ctrl+Shift+L (or click the globe). Type `5173` (or the printed port) → Enter → the running app renders in the panel. Drag the handle to resize toward half-screen. Edit a file via an agent and hit reload → the change shows. Open Quick Viewer too → both docks coexist. Click "open external" → the URL opens in the real browser.

- [ ] **Step 6: Commit the bundle**

```bash
git add src/lib/normalizePreviewUrl.ts src/lib/normalizePreviewUrl.test.ts src/store/previewStore.ts src/store/previewStore.test.ts src/lib/openExternal.ts src/components/icons.tsx src/components/Preview.tsx src/components/Preview.module.css src/components/TopBar.tsx src/hooks/useKeyboardShortcuts.ts src/App.tsx src-tauri/capabilities/default.json
git commit -m "$(cat <<'EOF'
feat(preview): localhost web preview panel (sibling to Quick Viewer)

A right-docked, resizable <iframe> panel for previewing a localhost dev
server inside the Workstation — see the app an agent is building without
alt-tabbing to a browser. Editable URL bar (bare ports normalize to
http://localhost:PORT), reload, and open-in-external-browser as the escape
hatch for servers that refuse to be iframed. Toggled by a TopBar globe
button and Ctrl+Shift+L. Coexists with the MD Quick Viewer dock.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

### Holistic review

- [ ] Dispatch a code-reviewer subagent over `git diff HEAD~1..HEAD`:
  - Panel default sizes sum to 100 for every open-set combination; the `key` re-inits on open-set change.
  - The Preview resize handle uses the `beginResize`/`endResize` gate (no terminal flicker).
  - The iframe `key` includes `reloadNonce` so reload forces a fresh load; URL bar commits on Enter/blur, not per keystroke.
  - `open external` is gated on a non-empty URL and surfaces failures via toast.
  - All colors via theme tokens (no raw hex except the intentional iframe white background, which is commented).
  - `TopBar` button carries `data-tauri-drag-region="false"`.
  - Capability: external-open works (Task 4 verified) without over-broadening shell scope.

---

## Self-Review (run before handing off)

**Spec coverage:**
- Resizable right-docked localhost iframe panel: Tasks 5 + 7. ✓
- Editable URL bar + Enter-to-load + normalization: Task 1 + 5. ✓
- Reload: Task 2 (`reloadNonce`) + 5. ✓
- Open-in-external escape hatch: Task 3 + 4 + 5. ✓
- Toggle (button + Ctrl+Shift+L): Task 6. ✓
- Coexists with Quick Viewer: Task 7 size logic. ✓
- Deferred (auto-detect from output, per-session binding, URL persistence): explicitly out of scope. ✓

**Placeholder scan:** every code step is complete; commands have expected output. ✓

**Type consistency:** `usePreviewStore` actions (`openPreview`/`closePreview`/`setUrl`/`reload`/`reset`), `normalizePreviewUrl`, `openExternal`, `IconGlobe` referenced consistently across TopBar / shortcuts / App / Preview. ✓
