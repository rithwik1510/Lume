# Plan 005: Atomic writes for user files and config (no truncation on crash)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 0cc44a3..HEAD -- src-tauri/src/fs.rs src-tauri/src/config.rs`
> EXPECTED drift: Plan 001 (async `_impl` wrappers) and Plan 004 (FsScope
> checks in fs.rs) may have landed — both fine; this plan changes only HOW
> bytes hit the disk. Other structural mismatches are STOP conditions.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (textually adjacent to 001/004 — if they are in flight on unmerged branches, land them first to avoid conflicts)
- **Category**: bug
- **Planned at**: commit `0cc44a3`, 2026-06-12

## Why this matters

Both user-facing write paths do an in-place `std::fs::write`:

- `write_text_file` (`src-tauri/src/fs.rs:79-90`) — saves the user's markdown
  files. A crash/power-cut mid-write **truncates the user's document**.
- `set_config_value` (`src-tauri/src/config.rs:413-423`) — read, edit,
  `std::fs::write` back. A crash mid-write corrupts `config.toml`; the loader
  then falls back to defaults and the user's settings are silently gone.

The standard fix is write-to-temp-then-rename in the same directory:
`std::fs::rename` on Windows uses `MoveFileExW(MOVEFILE_REPLACE_EXISTING)`,
which replaces the destination in one step — a crash leaves either the old
complete file or the new complete file, never a torn one.

## Current state

Excerpt — `src-tauri/src/fs.rs:79-90`:

```rust
#[tauri::command]
pub fn write_text_file(path: String, contents: String) -> AppResult<()> {
    if let Some(parent) = Path::new(&path).parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| AppError::Internal {
                reason: format!("create_dir_all {}: {}", parent.display(), e),
            })?;
        }
    }
    fs::write(&path, contents).map_err(|e| AppError::Internal {
        reason: format!("write {}: {}", path, e),
    })
}
```

Excerpt — `src-tauri/src/config.rs:413-423`:

```rust
#[tauri::command]
pub fn set_config_value(path: String, value: serde_json::Value) -> AppResult<()> {
    let p = config_path()?;
    write_default_at(&p)?; // no-op if present; ensures a file to edit
    let text = std::fs::read_to_string(&p)
        .map_err(|e| AppError::internal(format!("read {}: {}", p.display(), e)))?;
    let updated = apply_config_edit(&text, &path, value)?;
    std::fs::write(&p, updated)
        .map_err(|e| AppError::internal(format!("write {}: {}", p.display(), e)))?;
    Ok(())
}
```

There is also `write_default_at` in `config.rs` (writes the default config —
find it near `set_config_value`); it should use the same helper.

Conventions: `AppResult` / `AppError` everywhere, no `unwrap()`, `tempfile`
is already a dev-dependency (`src-tauri/Cargo.toml:44`) — but do NOT add it as
a runtime dependency; the helper below needs only `std`.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Rust tests | `cd src-tauri; cargo test --lib` | all pass |
| Lint | `cd src-tauri; cargo clippy --all-targets -- -D warnings` | exit 0 |
| Format | `cd src-tauri; cargo fmt --all -- --check` | exit 0 |

## Scope

**In scope**:
- `src-tauri/src/fs.rs` (helper + `write_text_file` body)
- `src-tauri/src/config.rs` (`set_config_value`, `write_default_at` bodies)

**Out of scope**:
- TS side (the commands' contracts are unchanged).
- The persisted Zustand store (`@tauri-apps/plugin-store` already writes atomically).
- Log files, shell-integration script writes.

## Git workflow

- Branch: `advisor/005-atomic-file-writes`
- Commit style: `fix(rust): atomic temp+rename writes for md saves and config edits`
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add the helper

In `src-tauri/src/fs.rs`, add a `pub(crate)` helper:

```rust
/// Crash-safe write: write to a sibling temp file, fsync, rename over the
/// target. On Windows, rename maps to MoveFileExW(MOVEFILE_REPLACE_EXISTING),
/// so a crash leaves either the old or the new file — never a torn one.
pub(crate) fn atomic_write(path: &Path, contents: &str) -> AppResult<()> {
    let parent = path.parent().ok_or_else(|| AppError::Internal {
        reason: format!("no parent dir for {}", path.display()),
    })?;
    if !parent.exists() {
        fs::create_dir_all(parent).map_err(/* match existing style */)?;
    }
    // Unique-enough temp name in the SAME directory (same volume → rename is atomic).
    let tmp = parent.join(format!(
        ".{}.tmp~{}",
        path.file_name().map(|n| n.to_string_lossy()).unwrap_or_default(),
        std::process::id()
    ));
    {
        let mut f = fs::File::create(&tmp).map_err(/* ... */)?;
        use std::io::Write as _;
        f.write_all(contents.as_bytes()).map_err(/* ... */)?;
        f.sync_all().map_err(/* ... */)?;
    }
    fs::rename(&tmp, path).map_err(|e| {
        let _ = fs::remove_file(&tmp); // best-effort cleanup; don't mask the error
        AppError::Internal { reason: format!("rename {} -> {}: {}", tmp.display(), path.display(), e) }
    })
}
```

Fill every `map_err` in the established style (`AppError::Internal { reason: format!(...) }`).

**Verify**: `cd src-tauri; cargo clippy --all-targets -- -D warnings` → exit 0
(after Step 2 uses it, in the same commit if needed).

### Step 2: Use it at all three write sites

1. `fs.rs::write_text_file` body → `atomic_write(Path::new(&path), &contents)`
   (the create_dir_all moves into the helper — remove the duplicated block).
   If Plan 004 landed, keep its `check_write` call FIRST, then `atomic_write`
   on the checked path.
2. `config.rs::set_config_value` → replace the final `std::fs::write` with
   `crate::fs::atomic_write(&p, &updated)`.
3. `config.rs::write_default_at` → same replacement for its write call.

**Verify**: `cd src-tauri; cargo test --lib` → all existing config tests pass.

### Step 3: Tests

In `fs.rs` `#[cfg(test)]` (create the module if absent; use `tempfile::tempdir()`):

1. `atomic_write_creates_file_with_contents` — write to a fresh path; read back equals input.
2. `atomic_write_replaces_existing_file` — write twice with different contents; read back equals the second.
3. `atomic_write_creates_missing_parent_dirs` — target under a not-yet-existing subdir.
4. `atomic_write_leaves_no_temp_file_on_success` — after writing, the parent dir contains exactly the target file.

**Verify**: `cd src-tauri; cargo test --lib` → all pass incl. 4 new.

### Step 4: Final sweep

**Verify**: `cargo fmt --all -- --check`, `cargo clippy --all-targets -- -D warnings`,
`cargo test --lib` exit 0. `npm test` + `npm run typecheck` (repo root) exit 0
(tripwire — no TS changes expected).

## Test plan

Step 3's four named cases, modeled on the existing `#[cfg(test)]` style in
`config.rs` (tempfile-based).

## Done criteria

ALL must hold:

- [ ] `Select-String -Path src-tauri/src/fs.rs,src-tauri/src/config.rs -Pattern "fs::write\("` → no matches outside the helper itself (the helper uses `File::create` + `write_all`, so ideally zero matches total)
- [ ] `cd src-tauri; cargo test --lib` exits 0 with the 4 new tests
- [ ] `cargo clippy --all-targets -- -D warnings` + `cargo fmt --all -- --check` exit 0
- [ ] `git status` clean outside the two in-scope files and `plans/README.md`
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back if:

- `write_default_at` doesn't exist or has a different name/shape in the live
  `config.rs` (search for the function writing the default config before
  improvising).
- `fs::rename` fails on a same-directory replace in tests on this machine
  (would contradict the Windows replace semantics this plan relies on).
- OneDrive file locking makes the rename flaky in the dev tree — report the
  observed error; do not add retry loops without review.

## Maintenance notes

- Any future Rust code writing user-visible files must use `atomic_write`;
  reviewers should grep for raw `fs::write` in new PRs.
- Note for the operator: `.tmp~` siblings can momentarily appear in the
  Sidebar's file watcher; if users report flicker, filter `*.tmp~` in the
  watcher (deferred — cosmetic).
- Deferred deliberately: fsyncing the parent directory (Windows offers no
  clean equivalent; the rename guarantee is sufficient for this threat model).
