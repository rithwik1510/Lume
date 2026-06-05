# Pre-Beta Audit — Findings & Fix Plan (2026-06-03)

Whole-codebase audit before the public beta. 7 parallel reviewers (security, Rust×2, FE state, FE terminals, FE misc, FE components) + controller verification of the high-impact items. Findings deduped and prioritized below. Each "✅ verified" was re-confirmed by the controller reading the actual code.

Severity = impact × reachability. **Regression risk** = how likely a fix is to change app behavior (the user's hard constraint: *no impact on the working of the app*).

---

## Tier A — Fix now (high value, LOW regression risk)

These are guard-clauses, additive hardening, or isolated fixes. Each ships behind the five gates + new tests.

| # | Sev | Where | Bug | Fix | Verified |
|---|-----|-------|-----|-----|----------|
| A1 | High | `useKeyboardShortcuts.ts:439` | Capture-phase window keydown has **no form-field guard** → `Ctrl+W/E/O/B/Arrows/1-9` hijack typing in the Preview URL bar, file filter, rename fields. | Skip shortcuts when `e.target` is `<input>/<textarea>/contentEditable` **but NOT inside `.xterm`** (xterm uses a hidden textarea — a naive guard would kill terminal shortcuts). | ✅ verified (incl. the xterm trap) |
| A2 | High | `orchestrator.ts:55-62, 135` | `changeShell` → `killPty` + `spawnPane` never disposes the old `onData` wire; `spawnPane` clobbers `runtimes` → **double keystrokes** after a shell swap. | `spawnPane` disposes any existing runtime for the paneId before registering the new wire (makes spawn idempotent). | ✅ verified |
| A3 | High | `renderMarkdown.ts:10-14` | Rendered markdown links have no `rel`/`target`; clicking navigates the **main webview away** (app replaced) + reverse-tabnabbing. (`javascript:` is already blocked by DOMPurify default.) | DOMPurify `afterSanitizeAttributes` hook → `target="_blank" rel="noopener noreferrer"`; intercept anchor clicks in the preview container → `openExternal`. | ✅ verified |
| A4 | Med | `sessionsStore.ts:327-339` | `onRehydrateStorage` has no try/catch; a corrupt persisted layout tree throws in `remapTreePaneIds` → hydration never finishes → **stuck blank boot** (App gates bootstrap on `onFinishHydration`). | Wrap coerce+remap in try/catch; fall back to `emptyState()` + console.error. | ✅ verified |
| A5 | Med | `mdStore.ts` | `closeMdTab` discards a dirty tab with **no confirm**; `openMdInQuickViewer`/`openMdTab` have stale-write/duplicate races; `saveMdTab` clears `dirty` without compare-and-clear. | Add dirty-confirm on close (reuse `confirmStore`); guard stale writes by path; compare-and-clear dirty. | ✅ verified (closeMdTab); reports for races |
| A6 | Med | `mdLinkProvider.ts` + `mdStore.openMdInQuickViewer` | An **absolute** `.md` path printed by any process becomes a one-click read of *any* file on disk (relative paths are cwd-scoped; absolute bypass that). | Scope the read to the owning session's `folderPath` (or configured roots); otherwise no-op/confirm. | ✅ verified (logic) |
| A7 | Med | `attachPath.ts:32` + `pasteFileToPane.ts:18` | Filename pasted to a pane is quoted only on whitespace and never escapes embedded quotes; an embedded `\r` in a crafted filename **submits the line**. | Reject/strip control chars (`/[\x00-\x1f\x7f]/`) before paste; robust per-shell quoting. | report (high-conf) |
| A8 | High/Med | `Preview.tsx:135` + `normalizePreviewUrl.ts:15` + `previewStore.ts:37,39` + `openExternal.ts` | Preview `<iframe>` has **no `sandbox`**; `normalizePreviewUrl` passes through any host (not just localhost); `setUrl`/`openPreview` bypass normalization; `openExternal` has no scheme check. | Add `sandbox="allow-scripts allow-forms allow-same-origin"`; restrict normalize to localhost/127.0.0.1/::1; funnel `setUrl`/`openPreview` through it; `openExternal` allows `http(s)` only. | ✅ verified (we wrote these) |
| A9 | Low | misc | Leaks/ordering: `settingsStore.reset` doesn't drain `persistTimers`; `confirmStore.resolve` clears state before resolving; `usePresence` exit-timer not cleared on fast unmount; `branchPoller` module singletons not reset / double-install; `registry.applyOptionsToAll` calls `fit()` on unopened terminals. | Small targeted fixes per report. | reports (high-conf) |
| A10 | Med | `PaneTree.tsx:74,184` | `focusedPaneId` selector returns the global id → **every** LeafFrame re-renders on any focus change; `SplitFrame` not memoized; inline style objects. | Boolean per-pane selector (`s.focusedPaneId === paneId`); `memo(SplitFrame)`; hoist static styles. | ✅ verified |
| A11 | High | `npm/bin/lume.js:41-46` | Installer downloads+executes the `.exe` with **no signature/host check** while a `.sig` sits in the release; coaches users past SmartScreen. (Isolated to the npm package — zero app risk.) | Verify the `.sig` against the bundled minisign pubkey (Node Ed25519) + assert HTTPS + `*.github*` host before exec. | ✅ verified (we wrote it) |
| A12 | Low | `App.tsx:97` | `initWithFirstPane("pane-1")` hardcodes a paneId below the `nextPaneId` base — latent collision footgun. | Seed via `nextPaneId()`. | ✅ verified |
| A13 | Low/Med | Rust `config.rs`, `fs.rs`, `shell_detect.rs` | `as i64` truncation on config/timestamp casts; `write_default_at` + `set_config_value` TOCTOU (non-atomic write); `read/write_text_file` lack `list_dir`'s canonicalize; `wsl -l` odd-byte `chunks_exact` drops a byte. | `i64::try_from`; atomic `create_new` / temp-file+rename; canonicalize parity; odd-length guard. | reports (high-conf) |

**Plus tests** (the user asked for tests "to help debug later"): `commandCapture` edge cases (and **fix** its ESC state machine — it leaks OSC `ESC]…BEL` title text and mishandles SS3/bracketed-paste/astral chars — `commandCapture.ts:36-49`, ✅ verified as a real gap); first `orchestrator` lifecycle tests; `normalizePreviewUrl` rejection cases; `renderMarkdown` XSS+link-hardening; `mdStore` races/dirty-confirm; `sessionsStore` revive + rehydrate-crash; `is_pty_busy` unknown-pane.

---

## Tier B — Behavior-changing, HIGHER regression risk (need explicit go + an app smoke test)

These are real and high-value, but each changes how the app *works* and can only be truly validated by **running the app** (which I can't observe headlessly). Flagging for your call.

- **B1 — PTY bytes are JSON-serialized (Critical perf).** ✅ verified: `PtyEvent` derives `Serialize` and is sent over `Channel<PtyEvent>` (`pty.rs:51-57,284`); Tauri JSON-encodes it, JS does `new Uint8Array(evt.bytes)` over an integer array. Every byte of terminal output becomes ~3-4 JSON chars + a parse. This directly violates DESIGN §4 ("bytes must NEVER be JSON-serialized") and is the single biggest perf liability. **Fix** = send Data as raw bytes (`tauri::ipc::Response`/`InvokeResponseBody::Raw`) + update the JS handler in lockstep. Risk: a mistake breaks ALL terminal output. Needs a real smoke test.
- **B2 — `csp: null` (High security, defense-in-depth).** ✅ verified (`tauri.conf.json:27`). Today XSS≈RCE with no browser backstop. **Fix** = a strict CSP, but it can break webfonts / the localhost preview iframe / updater fetch if mis-tuned. Needs a smoke test of fonts + preview + update check.
- **B3 — `pty_kill` doesn't kill the child (High correctness/leak).** ✅ verified (`pty.rs:350-356` only sets `closed` + drops; no `ChildKiller` stored). A surviving child leaks the reader+waiter threads + up to 8MB, and "close the pane to kill Claude Code" is unreliable. **Fix** = store `child.clone_killer()`, call `kill()` on `pty_kill`/reopen. Risk: process-lifecycle change; needs a smoke test (closing a pane terminates the tree, no zombies).

## Tier C — Decision / ops (not code)

- **C1 — GitHub namespace mismatch.** ✅ verified: updater endpoint + npm installer both pin `github.com/rithwik1510/Workflow`, but product is `com.posan.lume` / npm `lume-desktop` / publisher "Posan". If that repo is renamed/deleted/lapses, the namespace can be taken over → malicious `latest.json`/installer. Decide the canonical owner and protect it. (B1-style installer signature verification (A11) largely neutralizes the npx path.)

## Tier D — Defer / document (low value or accepted design)

`is_pty_busy` PID-reuse/conhost-inflation heuristic (`pty.rs`); `list_dir` pagination for huge dirs; `PanelGroup` key-remount cost on panel toggle; ring-buffer UTF-8 boundary split on >8MB overflow; `window.prompt` for new-file name in `FileDrawer`; persist `migrate()` scaffolding; multi-session paneId-uniqueness defense. All low-reachability or intentional tradeoffs; noted, not fixed for beta.

---

## Notable NON-findings (verified safe — do not "fix")

- Rust process spawning uses argv vectors (no shell-string injection); `git` uses a fixed argv with the path only as cwd; log clamps correctly suppress env-var/secret TRACE logs; config parsing is strict-with-fallback. (Security reviewer confirmed.)
- Multiple sessions staying "active" on switch is **by design** (background agents keep running — the fleet north-star), not a PTY leak.
- DOMPurify default blocks `javascript:`/dangerous `data:` — the markdown script-URL path is NOT reachable (the link issue is navigation/tabnabbing, A3).
