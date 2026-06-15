# Plan 004: Scope filesystem commands + lock the preview iframe to localhost

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 0cc44a3..HEAD -- src-tauri/src/fs.rs src-tauri/src/lib.rs src-tauri/tauri.conf.json src/lib/dialogClient.ts src/lib/normalizePreviewUrl.ts`
> EXPECTED drift: Plan 001 made fs commands `async fn` wrapping `_impl`
> functions; Plan 005 may have added an `atomic_write` helper. Both fine.
> Other structural mismatches with "Current state" are STOP conditions.

## Status

- **Priority**: P2
- **Effort**: L
- **Risk**: MED
- **Depends on**: plans/001-async-tauri-commands.md (fs command shape)
- **Category**: security
- **Planned at**: commit `0cc44a3`, 2026-06-12

## Why this matters

This is **defense-in-depth for a renderer compromise**, not a fix for a known
exploit. Lume renders untrusted content (markdown written by agents, terminal
output) inside a WebView2 that can invoke Tauri commands. Today:

- `read_text_file` / `write_text_file` / `list_dir`
  (`src-tauri/src/fs.rs:47-90`) accept **any absolute path** from the
  renderer. A compromised renderer could read `~/.ssh/id_rsa` or
  `~/.aws/credentials`, or overwrite arbitrary user files.
- The CSP allows `frame-src http: https:` (`src-tauri/tauri.conf.json:28-29`),
  so the localhost Preview panel could be pointed at any external origin.

After this plan: fs commands only operate inside *registered workspace roots*
or on *files the user explicitly picked in an OS dialog* (the dialog moves to
the Rust side so the pick itself is the trust anchor); a small denylist
(`.ssh`, `.aws`, `.gnupg`, `.kube`, `.azure`) is refused even inside roots;
the iframe is restricted to loopback origins.

**Honest residual risk (do not "fix" beyond scope):** `register_fs_root` is
callable from the renderer (needed for session restore), so a fully
compromised renderer can still register directories — the denylist and the
root requirement (must be an existing directory) are the remaining teeth.
Documenting that trade-off in code comments is part of this plan.

## Current state

- `src-tauri/src/fs.rs` — the three path commands + `home_dir`. Header comment
  (lines 2-9) currently *documents* the no-sandbox choice; this plan replaces
  that comment.
- `src-tauri/src/lib.rs` — `invoke_handler` (lines 60-78) and `.manage(...)`
  calls (lines 57-59); new state + commands register here.
- `src-tauri/tauri.conf.json` — `csp` and `devCsp` both contain
  `frame-src http: https:`.
- `src/lib/dialogClient.ts` — thin wrapper over `@tauri-apps/plugin-dialog`'s
  JS `open()`; exports `pickFolder()` and `pickMdFile()`. Consumers:
  `src/hooks/useKeyboardShortcuts.ts:201,280`, `src/components/MdEditor.tsx:59`,
  `src/lib/sessions/sessionEntryFlows.ts:39,52`. Tests mock this module
  (`src/components/TopBar.test.tsx:63`) — keep its exported signatures
  IDENTICAL (`Promise<string | null>`).
- `src/lib/normalizePreviewUrl.ts` (+ `.test.ts`) — normalizes the Preview
  panel URL input.
- Session folders that must be readable after restart: persisted sessions'
  `folderPath` (`src/store/sessionsStore.ts`) and the sidebar
  `workspaceFolder` (`src/store/sidebarStore.ts:78`). `src/sessions/migration.ts:45`
  seeds a session at `homeDir()` for migrated installs.
- `Cargo.toml` already depends on `tauri-plugin-dialog = "2.0"` (Rust side
  available).

CONTEXT.md constraint this plan must honor (quoted): the MD Editor "has its
own file picker (Ctrl+O — opens an OS file dialog so any file on disk can be
opened, not just files in the Sidebar)". Dialog-picked files must keep
working from anywhere on disk — that's why the dialog becomes the Rust-side
trust anchor instead of being removed.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Rust tests | `cd src-tauri; cargo test --lib` | all pass |
| Lint | `cd src-tauri; cargo clippy --all-targets -- -D warnings` | exit 0 |
| Format | `cd src-tauri; cargo fmt --all -- --check` | exit 0 |
| TS tests | `npm test` | all pass |
| TS typecheck | `npm run typecheck` | exit 0 |
| Manual run | `npm run tauri dev` | app opens |

## Scope

**In scope**:
- `src-tauri/src/fs_scope.rs` (new)
- `src-tauri/src/fs.rs`
- `src-tauri/src/lib.rs` (state + command registration only)
- `src-tauri/tauri.conf.json` (frame-src only)
- `src/lib/dialogClient.ts`
- `src/lib/fsClient.ts` (add the register call)
- `src/store/sidebarStore.ts`, `src/lib/sessions/sessionEntryFlows.ts`,
  `src/sessions/migration.ts`, `src/App.tsx` (root-registration call sites only)
- `src/lib/normalizePreviewUrl.ts` + `src/lib/normalizePreviewUrl.test.ts`

**Out of scope** (do NOT touch):
- `src-tauri/src/config.rs` commands (they operate on the app's own config dir).
- The markdown sanitization pipeline (`src/preview/renderMarkdown.ts`).
- CSP directives other than `frame-src`.
- The updater, `npm/` package, `website/`.

## Git workflow

- Branch: `advisor/004-renderer-fs-hardening`
- Commit style: `fix(security): scope fs commands to workspace roots + localhost-only preview frames` (repo precedent: `fix(security): harden markdown links + preview iframe isolation`)
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Build `FsScope` in Rust with unit tests

New file `src-tauri/src/fs_scope.rs`:

```rust
pub struct FsScope {
    roots: parking_lot::RwLock<HashSet<PathBuf>>,   // canonicalized dirs
    files: parking_lot::RwLock<HashSet<PathBuf>>,   // canonicalized dialog picks
}
```

Methods (all operate on canonicalized paths; canonicalize INSIDE the check so
symlinks can't escape):

- `register_root(&self, path: &str) -> AppResult<()>` — canonicalize; must be
  an existing directory; must not be (or contain as ancestor) a denylisted
  segment; insert.
- `register_file(&self, path: &str) -> AppResult<()>` — canonicalize; must be
  an existing file; not denylisted; insert.
- `check_read(&self, path: &str) -> AppResult<PathBuf>` /
  `check_write(&self, path: &str) -> AppResult<PathBuf>` — canonicalize
  (for write of a not-yet-existing file: canonicalize the parent and re-append
  the file name); deny if any ancestor directory NAME is in the denylist;
  allow if equal to a registered file or descendant of a registered root;
  else `Err(AppError::...)` with reason `"path outside allowed workspace"`.
- Denylist (directory names, compared case-insensitively):
  `.ssh`, `.aws`, `.gnupg`, `.kube`, `.azure`.

Unit tests in the same file using `tempfile` (already a dev-dependency):
root + child allowed; sibling of root denied; denylisted subdir denied even
under a root; registered single file allowed, its sibling denied; symlink
pointing outside the root denied (create with
`std::os::windows::fs::symlink_dir` — mark `#[cfg(windows)]` and skip
gracefully if the OS denies symlink creation without developer mode: treat
`symlink_dir` Err as test-skip via early `return`).

Declare `pub mod fs_scope;` in `lib.rs`.

**Verify**: `cd src-tauri; cargo test --lib` → all pass incl. new fs_scope tests.

### Step 2: Enforce in fs commands + add registration commands

In `fs.rs`: each of `list_dir` / `read_text_file` / `write_text_file` takes
`scope: State<'_, fs_scope::FsScope>` and passes the path through
`check_read` / `check_write` first, operating on the returned canonical path.
Replace the header SECURITY NOTE (lines 2-9) with a comment describing the
scope model and the residual-risk trade-off quoted in "Why this matters".

New commands (register in `lib.rs` handler + `.manage(FsScope::default())`):

- `register_fs_root(path, scope) -> AppResult<()>` → `scope.register_root`
- `pick_folder_scoped(app: AppHandle, scope) -> AppResult<Option<String>>` —
  Rust-side dialog via `tauri_plugin_dialog::DialogExt`:
  `app.dialog().file().blocking_pick_folder()`; on pick, `register_root` it
  and return the path string. Run inside `tauri::async_runtime::spawn_blocking`
  (blocking dialog must not sit on the async pool thread; command itself is
  `async fn` taking `AppHandle` which is `Send + 'static`).
- `pick_md_file_scoped(app, scope) -> AppResult<Option<String>>` — same with
  `.add_filter("Markdown", &["md", "markdown", "mdx", "txt"])` and
  `blocking_pick_file()`; on pick, `register_file`.

**Verify**: `cargo clippy --all-targets -- -D warnings` → exit 0;
`cargo test --lib` → pass.

### Step 3: Switch the front-end pickers and register restored roots

1. `src/lib/dialogClient.ts`: reimplement `pickFolder` / `pickMdFile` as
   `invoke<string | null>("pick_folder_scoped")` / `("pick_md_file_scoped")`.
   Exported names and signatures unchanged; remove the
   `@tauri-apps/plugin-dialog` import. (Consumers and test mocks untouched.)
2. `src/lib/fsClient.ts`: add
   `export function registerFsRoot(path: string): Promise<void> { return invoke("register_fs_root", { path }); }`
3. Call `registerFsRoot` (fire-and-forget `void ... .catch(console.warn)`) at
   the places a legitimate root (re)enters the app:
   - `src/store/sidebarStore.ts:78` — where `s.workspaceFolder = path` is set;
   - `src/lib/sessions/sessionEntryFlows.ts` — after each `pickFolder()`
     result is accepted (lines ~39, ~52) — belt-and-braces; the Rust pick
     already registered it;
   - `src/sessions/migration.ts:45` — the seeded folder;
   - `src/App.tsx` — on boot, iterate persisted sessions' `folderPath`s and
     the persisted `workspaceFolder` and register each. Find the existing boot
     effect that rehydrates sessions (search `useEffect` in `App.tsx` around
     the migration/restore wiring) and add registration there, AFTER stores
     rehydrate.
4. `npm test` — fix any store test that now needs the new fsClient function
   mocked; follow the existing mocking pattern in
   `src/components/TopBar.test.tsx` (vi.mock of the lib module).

**Verify**: `npm run typecheck` → exit 0; `npm test` → all pass.

### Step 4: Lock frame-src to loopback + align normalizePreviewUrl

1. `src-tauri/tauri.conf.json`: in BOTH `csp` and `devCsp`, replace
   `frame-src http: https:` with
   `frame-src http://localhost:* https://localhost:* http://127.0.0.1:* http://[::1]:*`.
2. Read `src/lib/normalizePreviewUrl.ts`. Add explicit rejection (return
   `null` or the module's existing error convention — match it) for any
   hostname that is not `localhost`, `127.0.0.1`, or `[::1]`, so users get the
   module's normal invalid-URL feedback instead of a silently blank iframe.
3. Extend `src/lib/normalizePreviewUrl.test.ts`: `http://example.com` →
   rejected; `http://localhost:3000` → accepted; `https://localhost:8443` →
   accepted; `http://127.0.0.1:5173/path` → accepted.

**Verify**: `npm test` → all pass including the new cases.

### Step 5: Manual smoke

`npm run tauri dev`:
1. Open a session via "+ New session" (folder picker works, native dialog).
2. Sidebar file tree renders; open an `.md` from the tree (Quick Viewer OK).
3. MD Editor Ctrl+O → pick a file OUTSIDE the workspace (e.g. in Downloads) →
   opens fine (dialog trust anchor works).
4. Save an MD edit inside the workspace → saves, toast OK.
5. Preview panel: a running localhost dev server renders; entering an
   external URL is rejected with the module's invalid-URL feedback.

**Verify**: all five hold; otherwise STOP. If you cannot run a GUI, flag
"NOT RUN — needs operator smoke test".

## Test plan

- Rust: fs_scope unit tests (Step 1 list — 6 named cases).
- TS: normalizePreviewUrl new cases (Step 4); existing suites stay green.
- Pattern exemplars: `src-tauri/src/config.rs` `#[cfg(test)]` for Rust style;
  `src/lib/normalizePreviewUrl.test.ts` for vitest style.

## Done criteria

ALL must hold:

- [ ] `Select-String -Path src-tauri/tauri.conf.json -Pattern "frame-src http: https:"` → no matches
- [ ] `Select-String -Path src/lib/dialogClient.ts -Pattern "plugin-dialog"` → no matches
- [ ] `Select-String -Path src-tauri/src/fs.rs -Pattern "check_read|check_write"` → ≥3 matches
- [ ] `cd src-tauri; cargo test --lib` exits 0; `npm test` exits 0; `npm run typecheck` exits 0
- [ ] `cargo clippy --all-targets -- -D warnings` + `cargo fmt --all -- --check` exit 0
- [ ] Step 5 smoke recorded as passed or flagged NOT RUN
- [ ] `git status` clean outside the in-scope list and `plans/README.md`
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- `tauri-plugin-dialog`'s Rust API lacks `blocking_pick_folder`/file in the
  pinned version — do not bump the dependency; report.
- Registering roots on boot can't find a post-rehydration hook in `App.tsx`
  (persistence wiring differs from this plan's description).
- Any legitimate flow in Step 5 breaks and the fix would mean weakening
  `check_read`/`check_write` beyond adding a registration call site.
- You feel the need to touch the markdown pipeline or other CSP directives.

## Maintenance notes

- Every future fs-touching command MUST take `State<FsScope>` and call a
  check — reviewer should reject any that don't.
- If session persistence ever moves to the Rust side, `register_fs_root` can
  become internal and the residual risk note in fs.rs shrinks accordingly.
- The denylist is intentionally tiny (5 entries); resist growing it into a
  blocklist-of-everything — the roots model is the real boundary.
- Deferred deliberately: scoping `pty_open`'s `cwd` (low value — the shell
  can `cd` anywhere by design); Tauri capability-file tightening (separate
  audit).
