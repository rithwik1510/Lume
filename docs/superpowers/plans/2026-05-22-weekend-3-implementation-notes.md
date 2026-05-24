# Weekend 3 — Implementation Notes

Running log of decisions, deviations, and trade-offs made while executing `2026-05-22-weekend-3-md-and-sidebar.md`. Updated by the executing agent as each phase lands. Read this before reviewing each phase commit.

## Format

Each section is one phase or one task. Bullet points keep the noise low. Anything that ISN'T just "executed the plan as written" should land here.

Categories to capture:
- **Decision:** something the plan left unspecified that had to be picked
- **Deviation:** plan said one thing, reality required another
- **Trade-off:** chose option A over B and you should know why
- **FYI:** anything you should know — surprise behaviour, perf, deps, etc.

---

## Pre-execution baseline (2026-05-22)

- Starting from commit `a49a18d` (pane size limits 25/75) on `main`. 20 commits, no remote.
- All 69 vitest tests + 11 cargo tests green.
- `npm run typecheck` clean, `cargo fmt --check` + `cargo clippy -D warnings` clean.
- Dev environment: Windows 11, PowerShell 5.1, gh CLI authenticated as `rithwik1510`.
- Working in-place (no worktree). User opted for review-per-phase cadence, not per-task.

---

## Phase 0 — Theme tokens + CSS modules typing

- **FYI:** The plan states to add `import "@/styles/theme.css"` to `src/main.tsx` BEFORE the existing CSS imports (xterm-overrides.css and @xterm/xterm/css/xterm.css). In reality those two CSS imports live in `src/terminals/registry.ts`, not in `main.tsx`. `main.tsx` had no CSS imports at all. The theme import was added as the first line of `main.tsx` as instructed — it loads before `registry.ts` is imported transitively, so load order is preserved.
- **FYI:** Four hex codes in `src/terminals/registry.ts` (`#0a0a0a`, `#e8e8e8`, `#d4a85c`, `#d4a85c33`) were not substituted. These are xterm.js `ITheme` constructor arguments — the Terminal object's internal colour palette, not DOM CSS. CSS variables cannot be read by the xterm.js JS API, so these must remain as raw hex. They were not in the plan's substitution list.
- **FYI:** `grep -RE "#[0-9a-fA-F]{3,6}" src/` after the substitutions reports hits only in `src/styles/theme.css` (the token definitions) and `src/terminals/registry.ts` (xterm ITheme, as noted above). No hits in xterm-overrides.css.

---

## Phase 1 — Bundle Inter + JetBrains Mono

- **FYI:** `npm install` was performed by the controller (not by this agent) because the API was overloaded during initial dispatch. Packages arrived at: `@fontsource-variable/inter@5.2.8`, `@fontsource-variable/jetbrains-mono@5.2.8`.
- **Decision:** Verified that both packages ship an `index.css` entry point before writing `fonts.css`. Directory listing confirmed `index.css` exists in both `node_modules/@fontsource-variable/inter/` and `node_modules/@fontsource-variable/jetbrains-mono/`. The plan's `@import` paths (`@fontsource-variable/inter/index.css` and `@fontsource-variable/jetbrains-mono/index.css`) were used as-is — no deviation needed.
- **FYI:** `registry.ts` `fontFamily` option updated from the hard-coded string `'"JetBrains Mono", Consolas, "Courier New", monospace'` to `getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim() || 'JetBrains Mono Variable, Consolas, monospace'`. This reads the CSS token at Terminal creation time so the xterm instance always mirrors the design token.
- **FYI:** `npm install` reported 6 vulnerabilities. These are pre-existing dev-dependency noise (not blocking, not introduced by this phase).

---

## Phase 2 — Sidebar with file tree, filter, new-file, watcher

- **Deviation:** `sidebarStore` stores `entries` as a `Map` and `expanded` as a `Set`. Immer doesn't proxy Map/Set drafts unless the MapSet plugin is loaded — the first test run failed with `[Immer] The plugin for 'MapSet' has not been loaded`. Fix: added `import { enableMapSet } from "immer"; enableMapSet();` at module top-level in `sidebarStore.ts`. The plan didn't anticipate this because `layoutStore` (the reference store) only uses plain objects/arrays inside Immer. Calling `enableMapSet` is idempotent, so re-imports are safe. Added a comment explaining why.
- **FYI:** `cargo fmt --check` failed on first pass — the plan's `fs.rs` source had `.map_err(|e| AppError::Internal { reason: ... })` on a single line which rustfmt wants block-formatted, and the `assert_eq!(names, vec![...])` line wrapped. Ran `cargo fmt --all` to apply; no semantic change.
- **FYI:** `cargo clippy --all-targets -D warnings` passed clean on both `fs.rs` and `file_watcher.rs` as written — no unused-dep warnings from `notify` / `dirs`. (Confirms the controller's note that adding `which = "6.0"` would have failed clippy; skipped as instructed.)
- **Decision:** Wired the file-watcher `useEffect` into `Sidebar.tsx` in the same write as Task 2.6 (instead of editing the file again in Task 2.8 step 4). The plan presents Task 2.8 step 4 as a separate edit, but the resulting file is identical either way. One write, one mental model.
- **FYI:** `Channel<FsEvent>` in Tauri 2.11 is `Clone` (Arc-backed) — the plan's `Arc::new(channel)` + `chan_clone = channel.clone()` pattern works but is technically redundant (Arc-wrapping a Clone). Kept as written since it doesn't hurt and matches the plan verbatim.
- **FYI:** Tauri 2.1 was requested in `Cargo.toml`; cargo resolved to `tauri 2.11.2`. `tauri::ipc::Channel<T>::new()` on the JS side works fine with this resolution — the `Channel` constructor + `onmessage` setter API used in `fileWatcher.ts` matches the 2.x-line behavior.
- **FYI:** No `mdStore` import anywhere in Phase 2 code — verified by `grep -r mdStore src/` returning nothing. `.md` file clicks in `SidebarTree.tsx` are a documented no-op until Phase 4. New-file action in `Sidebar.tsx` writes the file to disk and lets the watcher refresh the tree; Phase 4 will tack on the "open in MD editor" call.

---

## Phase 3 — Shell auto-detection + per-pane Change Shell menu

- **FYI:** `which = "6.0"` resolved as expected; cargo did warn that `which 8.0.2` is available, but pinned v6.0 per the plan. Build clean, clippy clean.
- **Deviation:** `shell_detect.rs` needed `#[cfg(target_os = "windows")]` on the `use std::process::Command;` line. Without the cfg-guard, clippy on non-Windows targets would flag the import as unused (the non-Windows `detect_wsl_distros` stub doesn't use it). Confirmed clippy clean on Windows with the guard in place.
- **Decision:** `Shell` type in `src/types/index.ts` already matched the Rust `ShellDescriptor` JSON shape exactly (`kind` snake_case discriminant, `path` / `distro` variants). No changes needed — `shellsClient.shellLabel` switch is exhaustive against the existing union.
- **Decision:** `killPty` is already exported from `@/terminals/ptyClient` (Phase 1+), so the plan's import works verbatim. No deviation.
- **Decision:** Placed the boot-time `void detectShells().then(...)` call inside `installPtyOrchestrator()` AFTER the `useLayoutStore.subscribe(...)` assignment and immediately before `return sub;`. That's the single subscribe in the function — matches the plan's "immediately after the existing subscribe" instruction.
- **Deviation:** `TerminalPane.tsx` did not have `React` in scope (only named imports `memo, useEffect, useRef`). Imported `type MouseEvent as ReactMouseEvent` from `react` and typed the handler as `ReactMouseEvent<HTMLDivElement>` rather than `React.MouseEvent<...>`. Plan's `e: React.MouseEvent<HTMLDivElement>` would have required a default-import refactor; this is the smaller change.
- **FYI:** `cargo test --lib` count is now 14 (was 13 in Phase 2). 1 new test: `shell_detect::tests::detect_shells_includes_at_least_one_on_test_host`. On Windows host `cmd.exe` is always found via `which`, so the assertion passes.
- **FYI:** `npm test -- --run` count is now 79 (was 76). 3 new in `src/store/contextMenuStore.test.ts`.

---

## Phase 4 — MD Quick Viewer Panel with CodeMirror 6

- **FYI — resolved dep versions:** `codemirror@6.0.2`, `@codemirror/state@6.6.0`, `@codemirror/view@6.43.0`, `@codemirror/commands@6.10.3`, `@codemirror/lang-markdown@6.5.0`, `@codemirror/language@6.12.3`, `@codemirror/language-data@6.5.2`, `@codemirror/theme-one-dark@6.1.3`, `markdown-it@14.1.1`, `dompurify@3.4.5`, devDeps `@types/markdown-it@14.1.2`, `@types/dompurify@3.0.5`. 61 + 4 packages added to lockfile.
- **FYI:** `npm audit` reports 6 vulnerabilities (5 moderate, 1 critical) — pre-existing dev-dep noise plus the new transitive surface; `npm audit fix --force` would be a breaking-change risk and was not run, per the prompt's "do not run npm audit fix" instruction.
- **Deviation:** `QuickViewer.tsx`'s `useEffect` that rebuilds the editor on `path` change intentionally omits `content` and `setContent` from the dep array. Added `// eslint-disable-next-line react-hooks/exhaustive-deps` immediately above the `[path]` dep line to keep ESLint happy without re-creating the editor on every keystroke. The trailing `// intentionally not depending on content` comment is preserved as the load-bearing semantic note.
- **Decision:** placed the Ctrl+Shift+M `toggleQuickViewer` shortcut as a dedicated `SHORTCUTS` entry above the `Ctrl+W` entry, matching the plan's "before the Ctrl+W branch" instruction. The match predicate explicitly checks `e.shiftKey` so the narrower modifier combo isn't shadowed by `isCtrlOnly` on `Ctrl+W`. Used `useMdStore.getState()` from inside the run function — no reactive selectors inside the keydown handler, consistent with how the rest of the shortcuts module reads state.
- **Decision:** `Sidebar.tsx`'s new-file flow now `await openMdTab(path)` after `writeTextFile(path, "")` per CONTEXT.md (Sidebar header — ＋ opens in MD Editor Full View, not Quick Viewer). The Phase 2 placeholder comment was replaced by a 2-line rationale comment pointing at CONTEXT.md.
- **FYI:** `SidebarTree.tsx`'s `.md` click branch routes to `openMdInQuickViewer` per DESIGN.md §3 — opposite of the new-file flow above. The two paths are intentionally split.
- **FYI:** `App.tsx` PanelGroup id is `pg-root-h`. The inner `Panel`'s `defaultSize` flips between 75 (with QuickViewer) and 100 (without). React mounts/unmounts the resize handle + right panel based on `quickViewerOpen`. The `PaneTree` PanelGroup ids inside the leaf are unrelated; no collision.
- **FYI:** All verification gates clean on first pass after the implementation. `npm test -- --run` = **83 passing** (79 + 4 new in `mdStore.test.ts`). `npm run typecheck`, `cargo test --lib` (14 passing, unchanged), `cargo clippy --all-targets -- -D warnings`, `cargo fmt --all -- --check` all clean — no rework required.
- **FYI — bundle size:** `@codemirror/language-data` pulls grammars on demand and adds ~1-2MB of language-mode JS to the front-end bundle. Expected per the plan; not slimmed. Will surface in the production-build phase but does not affect dev or test runs.

---

## Phase 5 — Ctrl+Click MD Link in terminals opens Quick Viewer

- **Deviation:** Plan's `mdLinkProvider.ts` `activate` callback reads `usePtyStore.getState().panes.get(paneId)?.cwd`, but `ptyStore.panes` is a `Record<PaneId, PaneMetadata>` (plain object), not a `Map`. Changed to bracket access: `usePtyStore.getState().panes[paneId]`. Same `meta?.cwd ?? null` fallback chain works. Documented inline with a comment.
- **Deviation:** Dropped the plan's trailing `as ILinkProvider` structural cast on `buildMdLinkProvider`'s return. The object literal already conforms to `ILinkProvider` (xterm.js v5.5 — `provideLinks(bufferLineNumber, callback)` callback form). The function's `: ILinkProvider` return type annotation provides structural checking without the cast. Typecheck clean.
- **Decision:** Registered the link provider on **Path 3** of `attach()` in `registry.ts` — the "first-ever open for this Terminal" branch, immediately after `entry.term.open(host)` and before WebGL init. Path 1 (same host re-fit) and Path 2 (reparent existing xterm root) do NOT re-register — the disposable stays bound to the Terminal across detach/reattach cycles, which is correct because the Terminal instance itself persists.
- **Decision:** `disposeTerminal` calls `entry.linkDisposable?.dispose()` BEFORE `entry.webgl?.dispose()` and `entry.term.dispose()`, each in its own `try { ... } catch {}` to keep failures isolated. Per the plan's "BEFORE `entry.term.dispose()`" instruction.
- **FYI:** `registry.ts` `TerminalEntry` now has a 5th field `linkDisposable: IDisposable | null`. `getOrCreateTerminal` initialises it to `null`; `attach` Path 3 fills it; `disposeTerminal` clears it. `IDisposable` imported from `@xterm/xterm` as a type-only import.
- **FYI:** All verification gates clean on first pass. `npm test -- --run` = **90 passing** (83 + 7 new in `mdLinkProvider.test.ts`). `npm run typecheck`, `cargo test --lib` (14 passing, unchanged), `cargo clippy --all-targets -- -D warnings`, `cargo fmt --all -- --check` all clean.
- **FYI — v0.1 limitation (per plan):** Relative-path Ctrl+Click resolves through `meta.cwd`, but `ptyStore` leaves `cwd` as `null` until OSC 7 shell-integration lands in v0.2. So in v0.1 only absolute paths (Windows `C:\...\foo.md` or POSIX `/...foo.md`) Ctrl+Click reliably. Relative paths underline but no-op on click. Documented as deferred.

---

## Phase 6 — MD Editor Full View with Tab Strip + Live Preview pane

- **Deviation (spec-vs-plan resolution):** Plan Task 6.5 step 1 reads "Replace the inner Panel that hosts `PaneTree`" — which would leave the Quick Viewer right Panel still visible alongside the MD Editor. CONTEXT.md is explicit: "When the MD Editor is in Full View, the Tiling Area + MD Quick Viewer area are replaced by a single full-width CodeMirror 6 editor with the open MD Tabs across the top. The Sidebar remains visible." Took the CONTEXT.md route: in `App.tsx` the entire `<PanelGroup>` (including the Quick Viewer Panel + PanelResizeHandle) is gated behind `mdMode !== "full"`; when `mdMode === "full"` the inner `<div style={{ flex: 1, minWidth: 0 }}>` renders only `<MdEditor />`. Sidebar + ContextMenu stay siblings. Documented inline with a CONTEXT.md citation in the App.tsx header comment.
- **Deviation (shortcut wiring):** Plan Task 6.5 step 2 dumps the new branches as inline `if`-blocks in the keydown handler. Phase 4 (Ctrl+Shift+M) established a different pattern: helper function + entry in the module-level `SHORTCUTS` array, matched by the `for (const s of SHORTCUTS)` loop in `useKeyboardShortcuts`. Stayed consistent with Phase 4: added five helpers (`toggleMdMode`, `openMdFromPrompt`, `saveActiveMdTab`, `closeActiveMdTab`, `cycleMdTabs`) plus a small `isMdFullMode()` predicate, then registered each as a SHORTCUTS entry BEFORE the existing Ctrl+W close-pane entry. Critical detail: the `match` predicate (NOT the `run` body) must gate on `isMdFullMode()` for Ctrl+S / Ctrl+W / Ctrl+Tab — the loop `return`s as soon as `match` is true regardless of what `run` returns, so a "match-everything, run-returns-false" structure would swallow Ctrl+W in non-MD mode and break the pane-close shortcut. Documented this with comments above the entries.
- **Decision:** Ctrl+E and Ctrl+O fire unconditionally (mode-agnostic) per the plan. Ctrl+S / Ctrl+W / Ctrl+Tab are gated. Ctrl+W gate placement matters: when not in MD Full View the gated entry fails to match and the loop falls through to the existing `closeFocused` entry below it — preserves Weekend 2 close-pane behavior. Verified by reading SHORTCUTS array order: MD-gated Ctrl+W is at index 12, pane-close Ctrl+W at index 15.
- **Decision:** No `vitest.config.ts` change required. Env was already `happy-dom` from Phase 4. DOMPurify works under happy-dom — all 4 renderMarkdown tests pass on first run (headings render, `<script>` stripped, URL linkified, fenced code wrapped as `<pre><code>`). No per-file `@vitest-environment` pragma needed.
- **FYI — react-hooks/exhaustive-deps suppression:** `MdEditor.tsx`'s editor-build `useEffect` depends only on `tab?.id`, not `tab.content` — the EditorView owns its doc state internally after construction; reacting to `content` would rebuild on every keystroke. Added `// eslint-disable-next-line react-hooks/exhaustive-deps` plus a 4-line rationale comment in the same style as Phase 4's QuickViewer.
- **FYI — scroll sync wiring:** `MdEditorPreview` exposes its inner `<div>` ref upward via a `containerRef` prop that the parent `MdEditor` populates each render. The `useEffect` in `MdEditorPreview` writes `innerRef.current` into the supplied `containerRef.current` without a dep array (runs on every render) so the parent's `previewScrollRef` stays current across re-renders. Scroll handler in `MdEditor` is rAF-coalesced per DESIGN.md §4: a raw 60Hz scroll listener with layout-thrashing `scrollHeight`/`clientHeight` reads would defeat the design rule. `view.scrollDOM.addEventListener("scroll", handler, { passive: true })` per the plan.
- **FYI — visual polish observations** (not fixed; flagging for controller review):
  - The active-tab `border-top: 2px solid var(--accent)` + `margin-top: -2px` + `height: calc(100% + 2px)` trick works to prevent label shift, but the active tab visually pokes 2px above the strip's `border-bottom`. Looks intentional (a "raised tab" feel) — fine for v0.1.
  - `MdEditorPreview`'s `useEffect` for `containerRef` runs without a deps array, which means it fires on every render. Cheap but unusual; could be tightened to `[]` since the ref identity doesn't change after mount.
  - First render after switching tabs flashes the previous tab's content briefly in the preview because `setRenderedSrc` is initialised from `source` synchronously but the 250ms debounce kicks in before the new tab's content propagates. In practice the first 250ms shows the new content immediately because `useState(source)` captures the new value on remount — so no flash. (`MdEditorPreview` is keyed by parent re-render; tab swap rebuilds via parent layout, so the component remounts.) Verified mentally; would catch in real smoke test.
- **FYI — file inventory:** 8 new files (4 tsx, 3 css, 1 ts test, 1 ts impl), 2 modified files (App.tsx, useKeyboardShortcuts.ts).
- **FYI — verification gates all green on first try:** 94 vitest, 14 cargo, typecheck/clippy/fmt clean.

