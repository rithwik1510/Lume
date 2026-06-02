# Settings UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the ⚙ gear a real Settings panel — an Obsidian-style modal with toggles/dropdowns/steppers/chips for the high- and medium-value config options, plus new cursor + typography options, all writing format-preservingly back to `config.toml`.

**Architecture:** The GUI is a second editor of `config.toml` (single source of truth). A control change updates `settingsStore` optimistically (instant live-apply to xterm), then a debounced Rust `set_config_value` command edits only the changed key on disk via `toml_edit` (comments + `[keybindings]` preserved); the existing file watcher reconciles. On write failure: revert + error toast.

**Tech Stack:** React 18 + TypeScript + Zustand (existing), Tauri v2, Rust `toml_edit`, xterm.js, CSS modules, vitest, cargo test. Reuses the `ShortcutsModal` overlay + `usePresence` motion pattern verbatim.

**Reference spec:** `docs/superpowers/specs/2026-05-26-settings-ui-design.md`

**Verification gates (run after every task that touches code):**
```bash
npm run typecheck
npm test -- --run
cargo test --lib --manifest-path src-tauri/Cargo.toml
cargo clippy --all-targets --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check
```

---

## File structure

### New files
| Path | Responsibility |
|---|---|
| `src/store/settingsModalStore.ts` | `open`, `activeCategory`, open/close/setCategory. Tiny, mirrors `shortcutsModalStore`. |
| `src/components/SettingsModal.tsx` | The panel: presence, left rail, renders rows per category. |
| `src/components/SettingsModal.module.css` | Modal + rail + row layout; transitions copied from `ShortcutsModal`. |
| `src/components/settings/SettingRow.tsx` | Label + description + right-aligned control slot. |
| `src/components/settings/Toggle.tsx` | On/off switch. |
| `src/components/settings/Stepper.tsx` | Numeric −/value/+ with min/max/step. |
| `src/components/settings/Dropdown.tsx` | Themed `<select>`. |
| `src/components/settings/Segmented.tsx` | 2–3 option segmented control. |
| `src/components/settings/ChipList.tsx` | Add/remove string chips. |
| `src/components/settings/controls.module.css` | Shared styling for the primitives, on tokens. |
| `src/components/settings/controls.test.tsx` | Render + emit tests for each primitive. |
| `src/terminals/applySettings.ts` | Maps `settingsStore.config` → xterm options; pushes to all live terminals + refits; `installSettingsApply()` subscription. |

### Modified files
| Path | Change |
|---|---|
| `src/types/config.ts` | Add `font.weight`, `font.line_height`, `terminal.cursor_style`, `terminal.cursor_blink`. |
| `src-tauri/src/config.rs` | Extend structs + `DEFAULT_TOML`; add `set_config_value` command (`toml_edit`). |
| `src-tauri/src/lib.rs` | Register `set_config_value`. |
| `src-tauri/Cargo.toml` | Add `toml_edit = "0.22"`. |
| `src/lib/configClient.ts` | Add `setConfigValue` wrapper. |
| `src/lib/shellsClient.ts` | Add `shellToConfigId` / `configIdMatchesShell` helpers. |
| `src/store/settingsStore.ts` | Add `setConfigValue(path, value)` (optimistic + debounced persist + revert). |
| `src/terminals/registry.ts` | Read initial font/cursor/scrollback from settingsStore; add `applyOptionsToAll`. |
| `src/main.tsx` | Call `installSettingsApply()` after the boot `applyConfig`. |
| `src/components/TopBar.tsx` | Gear `onClick` opens `SettingsModal`. |
| `src/hooks/useKeyboardShortcuts.ts` | Bind `Ctrl+,` → open Settings. |
| `src/App.tsx` | Mount `<SettingsModal />` beside the other overlays. |

---

# Phase 1 — Config schema + Rust format-preserving write

## Task 1.1: Extend the config schema (TS + Rust + DEFAULT_TOML)

**Files:**
- Modify: `src/types/config.ts`
- Modify: `src-tauri/src/config.rs` (structs + `DEFAULT_TOML` + a Rust unit test)

- [ ] **Step 1: Add a failing Rust test for the new fields**

In `src-tauri/src/config.rs` (in the `#[cfg(test)] mod tests` block), add:

```rust
#[test]
fn default_toml_has_cursor_and_typography_fields() {
    let cfg: WorkstationConfig = toml::from_str(DEFAULT_TOML).expect("parse default toml");
    assert_eq!(cfg.font.weight, 400);
    assert!((cfg.font.line_height - 1.2).abs() < f64::EPSILON);
    assert_eq!(cfg.terminal.cursor_style, "block");
    assert!(cfg.terminal.cursor_blink);
}
```

- [ ] **Step 2: Run it — expect FAIL (fields don't exist)**

```bash
cargo test --lib --manifest-path src-tauri/Cargo.toml default_toml_has_cursor
```
Expected: compile error — no field `weight` on `FontConfig`.

- [ ] **Step 3: Extend the Rust structs with serde defaults**

In `src-tauri/src/config.rs`, update `FontConfig` and `TerminalConfig`. New fields use `#[serde(default = ...)]` so existing on-disk files without them still parse:

```rust
fn default_font_weight() -> u32 { 400 }
fn default_line_height() -> f64 { 1.2 }
fn default_cursor_style() -> String { "block".to_string() }
fn default_cursor_blink() -> bool { true }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FontConfig {
    pub family: String,
    pub size: u32,
    #[serde(default = "default_font_weight")]
    pub weight: u32,
    #[serde(default = "default_line_height")]
    pub line_height: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TerminalConfig {
    pub scrollback_lines: u32,
    pub ipc_batch_ms: u32,
    pub ring_buffer_mb: u32,
    #[serde(default = "default_cursor_style")]
    pub cursor_style: String,
    #[serde(default = "default_cursor_blink")]
    pub cursor_blink: bool,
}
```

> If `FontConfig` / `TerminalConfig` are constructed with explicit literals anywhere else in `config.rs` (e.g. a `Default` impl or another test), add the new fields there too — `cargo build` will point out each site.

- [ ] **Step 4: Update `DEFAULT_TOML`**

In the `[font]` and `[terminal]` blocks of the `DEFAULT_TOML` constant:

```toml
[font]
family = "JetBrains Mono"
size = 14
weight = 400              # 300 | 400 | 500 | 600
line_height = 1.2         # 1.0 – 2.0

[terminal]
scrollback_lines = 10000
ipc_batch_ms = 32
ring_buffer_mb = 8
cursor_style = "block"    # "bar" | "block" | "underline"
cursor_blink = true
```

- [ ] **Step 5: Mirror the fields in TypeScript**

In `src/types/config.ts`:

```typescript
export interface FontConfig {
  family: string;
  size: number;
  weight: number;       // 300 | 400 | 500 | 600
  line_height: number;  // 1.0 – 2.0
}

export interface TerminalConfig {
  scrollback_lines: number;
  ipc_batch_ms: number;
  ring_buffer_mb: number;
  cursor_style: "bar" | "block" | "underline";
  cursor_blink: boolean;
}
```

- [ ] **Step 6: Update the TS `defaultSettings`**

In `src/store/settingsStore.ts`, extend the `defaultSettings` literal:

```typescript
  font: { family: "JetBrains Mono", size: 14, weight: 400, line_height: 1.2 },
  terminal: {
    scrollback_lines: 10_000,
    ipc_batch_ms: 32,
    ring_buffer_mb: 8,
    cursor_style: "block",
    cursor_blink: true,
  },
```

- [ ] **Step 7: Run the gates**

```bash
cargo test --lib --manifest-path src-tauri/Cargo.toml
npm run typecheck
```
Expected: the new Rust test passes; typecheck clean.

- [ ] **Step 8: Commit (deferred — bundles with Phase 1)**

---

## Task 1.2: `set_config_value` Rust command (format-preserving)

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/config.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add the `toml_edit` dependency**

In `src-tauri/Cargo.toml` under `[dependencies]`:

```toml
toml_edit = "0.22"
```

- [ ] **Step 2: Write a failing test for dotted-path set + comment preservation**

In `src-tauri/src/config.rs` tests:

```rust
#[test]
fn set_dotted_value_preserves_comments_and_other_tables() {
    let original = "# top comment\n[font]\nsize = 14\n\n[keybindings]\n# custom\nsplit_right = \"Ctrl+\\\\\"\n";
    let updated = apply_config_edit(original, "font.size", json!(18)).unwrap();
    assert!(updated.contains("# top comment"));
    assert!(updated.contains("[keybindings]"));
    assert!(updated.contains("split_right = \"Ctrl+\\\\\""));
    assert!(updated.contains("size = 18"));
}

#[test]
fn set_dotted_value_creates_missing_table() {
    let updated = apply_config_edit("", "terminal.cursor_style", json!("bar")).unwrap();
    assert!(updated.contains("[terminal]"));
    assert!(updated.contains("cursor_style = \"bar\""));
}

#[test]
fn set_dotted_value_rejects_unknown_root() {
    // Guard: only known top-level tables/keys may be written.
    let err = apply_config_edit("", "bogus.key", json!(1));
    assert!(err.is_err());
}
```

Add `use serde_json::json;` to the test module if not present (serde_json is already a dependency via Tauri).

- [ ] **Step 3: Run — expect FAIL (`apply_config_edit` undefined)**

```bash
cargo test --lib --manifest-path src-tauri/Cargo.toml set_dotted_value
```

- [ ] **Step 4: Implement `apply_config_edit` + the command**

In `src-tauri/src/config.rs`:

```rust
use toml_edit::{DocumentMut, Item, Table, value as toml_value};

/// Known top-level config keys/tables the GUI is allowed to write. Anything
/// else is rejected so a malformed dotted path can't scribble into the file.
const WRITABLE_ROOTS: &[&str] = &[
    "default_shell", "font", "terminal", "md_editor",
    "quick_viewer", "sidebar", "theme", "log",
];

/// Convert a serde_json scalar/array into a toml_edit value. Objects are
/// rejected — the GUI only ever sets leaf scalars or string arrays.
fn json_to_toml(v: &serde_json::Value) -> AppResult<toml_edit::Value> {
    use serde_json::Value as J;
    Ok(match v {
        J::Bool(b) => toml_value(*b).into_value().unwrap(),
        J::Number(n) if n.is_i64() => toml_value(n.as_i64().unwrap()).into_value().unwrap(),
        J::Number(n) if n.is_u64() => toml_value(n.as_u64().unwrap() as i64).into_value().unwrap(),
        J::Number(n) => toml_value(n.as_f64().unwrap()).into_value().unwrap(),
        J::String(s) => toml_value(s.clone()).into_value().unwrap(),
        J::Array(items) => {
            let mut arr = toml_edit::Array::new();
            for it in items {
                match it {
                    J::String(s) => arr.push(s.as_str()),
                    _ => return Err(AppError::internal("array items must be strings")),
                }
            }
            toml_edit::Value::Array(arr)
        }
        J::Null | J::Object(_) => {
            return Err(AppError::internal("unsupported config value shape"))
        }
    })
}

/// Pure, unit-testable core: parse `text`, set the dotted `path` to `value`,
/// return the re-serialized document (comments/formatting preserved).
fn apply_config_edit(
    text: &str,
    path: &str,
    value: serde_json::Value,
) -> AppResult<String> {
    let segments: Vec<&str> = path.split('.').collect();
    let root = *segments.first().ok_or_else(|| AppError::internal("empty config path"))?;
    if !WRITABLE_ROOTS.contains(&root) {
        return Err(AppError::internal(format!("config path not writable: {path}")));
    }

    let mut doc = text.parse::<DocumentMut>()
        .map_err(|e| AppError::internal(format!("parse config.toml: {e}")))?;

    let leaf = json_to_toml(&value)?;

    if segments.len() == 1 {
        doc[root] = Item::Value(leaf);
        return Ok(doc.to_string());
    }

    // Walk/create intermediate tables, then set the leaf key.
    let mut tbl: &mut Table = doc.as_table_mut();
    for seg in &segments[..segments.len() - 1] {
        let entry = tbl.entry(seg).or_insert(Item::Table(Table::new()));
        tbl = entry.as_table_mut()
            .ok_or_else(|| AppError::internal(format!("config segment not a table: {seg}")))?;
    }
    let last = segments[segments.len() - 1];
    tbl[last] = Item::Value(leaf);
    Ok(doc.to_string())
}

/// Tauri command: read config.toml, set one dotted key, write it back.
/// Creates the file from defaults first if it's missing.
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

> Adjust `AppError::internal(...)` to match the actual constructor in `error.rs` (e.g. it may be `AppError::Internal(String)` or a builder). Check the existing usages already in `config.rs` and mirror them exactly.

- [ ] **Step 5: Register the command**

In `src-tauri/src/lib.rs`, add to the `tauri::generate_handler!` list next to the other `config::` entries:

```rust
            crate::config::set_config_value,
```

- [ ] **Step 6: Run the gates**

```bash
cargo test --lib --manifest-path src-tauri/Cargo.toml
cargo clippy --all-targets --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check
```
Expected: the three `set_dotted_value*` tests pass; clippy/fmt clean.

- [ ] **Step 7: Commit (deferred)**

---

## Task 1.3: `setConfigValue` TS client wrapper

**Files:**
- Modify: `src/lib/configClient.ts`

- [ ] **Step 1: Add the wrapper**

```typescript
/** Set one dotted config key on disk (format-preserving, Rust toml_edit). */
export function setConfigValue(path: string, value: unknown): Promise<void> {
  return invoke<void>("set_config_value", { path, value });
}
```

- [ ] **Step 2: Typecheck**

```bash
npm run typecheck
```
Expected: clean.

- [ ] **Step 3: Commit the Phase 1 bundle**

```bash
git add src/types/config.ts src/lib/configClient.ts src/store/settingsStore.ts src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/config.rs src-tauri/src/lib.rs
git commit -m "feat(settings): config schema + format-preserving set_config_value"
```

---

# Phase 2 — settingsStore.setConfigValue + live-apply

## Task 2.1: `setConfigValue` store action (optimistic + revert)

**Files:**
- Modify: `src/store/settingsStore.ts`
- Test: `src/store/settingsStore.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `src/store/settingsStore.test.ts` (mock the client so no Tauri is needed):

```typescript
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@/lib/configClient", () => ({
  setConfigValue: vi.fn(async () => undefined),
}));
import { setConfigValue as rustSetConfigValue } from "@/lib/configClient";
import { useSettingsStore } from "@/store/settingsStore";

describe("settingsStore.setConfigValue", () => {
  beforeEach(() => {
    useSettingsStore.getState().reset();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("updates the in-store config optimistically by dotted path", () => {
    useSettingsStore.getState().setConfigValue("font.size", 18);
    expect(useSettingsStore.getState().config.font.size).toBe(18);
  });

  it("persists via the Rust client (debounced)", async () => {
    vi.useFakeTimers();
    useSettingsStore.getState().setConfigValue("terminal.cursor_style", "bar");
    useSettingsStore.getState().setConfigValue("terminal.cursor_style", "underline");
    await vi.advanceTimersByTimeAsync(300);
    // Debounced: last write wins, one call.
    expect(rustSetConfigValue).toHaveBeenCalledTimes(1);
    expect(rustSetConfigValue).toHaveBeenCalledWith("terminal.cursor_style", "underline");
  });

  it("reverts the optimistic value when the Rust write rejects", async () => {
    vi.useFakeTimers();
    (rustSetConfigValue as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("disk full")
    );
    const before = useSettingsStore.getState().config.font.size;
    useSettingsStore.getState().setConfigValue("font.size", 22);
    expect(useSettingsStore.getState().config.font.size).toBe(22); // optimistic
    await vi.advanceTimersByTimeAsync(300);
    await Promise.resolve();
    expect(useSettingsStore.getState().config.font.size).toBe(before); // reverted
  });
});
```

- [ ] **Step 2: Run — expect FAIL (`setConfigValue` not a function)**

```bash
npm test -- --run src/store/settingsStore.test.ts
```

- [ ] **Step 3: Implement the action**

In `src/store/settingsStore.ts`. Add a module-level debounce map keyed by path and a dotted-set helper:

```typescript
import { setConfigValue as rustSetConfigValue } from "@/lib/configClient";
import { useToastStore } from "@/store/toastStore";

const PERSIST_DEBOUNCE_MS = 250;
const persistTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** Immutably set a dotted path on a deep-cloned config. */
function setDotted<T extends object>(obj: T, path: string, value: unknown): T {
  const next = structuredClone(obj);
  const segs = path.split(".");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cur: any = next;
  for (let i = 0; i < segs.length - 1; i++) cur = cur[segs[i]];
  cur[segs[segs.length - 1]] = value;
  return next;
}
```

Add to `SettingsActions`:

```typescript
  setConfigValue: (path: string, value: unknown) => void;
```

Implement inside the store:

```typescript
      setConfigValue: (path, value) => {
        const snapshot = get().config;
        set((s) => {
          s.config = setDotted(s.config, path, value);
        });
        const existing = persistTimers.get(path);
        if (existing) clearTimeout(existing);
        persistTimers.set(
          path,
          setTimeout(() => {
            persistTimers.delete(path);
            void rustSetConfigValue(path, value).catch((err) => {
              // Roll back to the pre-change snapshot + tell the user.
              set((s) => {
                s.config = snapshot;
              });
              useToastStore.getState().push({
                severity: "error",
                message: `Couldn't save settings: ${
                  err instanceof Error ? err.message : String(err)
                }`,
              });
            });
          }, PERSIST_DEBOUNCE_MS)
        );
      },
```

> `get` is already available in the `immer((set, get) => ...)` signature — if the current store only destructures `set`, add `get`.

- [ ] **Step 4: Run — expect PASS**

```bash
npm test -- --run src/store/settingsStore.test.ts
```

- [ ] **Step 5: Commit (deferred)**

---

## Task 2.2: Live-apply config → xterm

**Files:**
- Create: `src/terminals/applySettings.ts`
- Modify: `src/terminals/registry.ts`
- Modify: `src/main.tsx`
- Test: `src/terminals/applySettings.test.ts`

- [ ] **Step 1: Add `applyOptionsToAll` + config-driven init to `registry.ts`**

Add an exported helper that pushes options to every live terminal and refits:

```typescript
import type { ITerminalOptions } from "@xterm/xterm";

/** Apply a partial option set to every live Terminal, then refit so the new
 *  cell metrics reflow correctly. */
export function applyOptionsToAll(opts: Partial<ITerminalOptions>): void {
  for (const [, entry] of entries) {
    Object.assign(entry.term.options, opts);
    entry.fit.fit();
  }
}
```

Then change `getOrCreateTerminal` to read initial values from settingsStore instead of hardcoding. At the top of the file add `import { useSettingsStore } from "@/store/settingsStore";` and replace the hardcoded option literals:

```typescript
  const cfg = useSettingsStore.getState().config;
  const term = new Terminal({
    fontFamily:
      getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim() ||
      "JetBrains Mono Variable, Consolas, monospace",
    fontSize: cfg.font.size,
    fontWeight: String(cfg.font.weight) as ITerminalOptions["fontWeight"],
    lineHeight: cfg.font.line_height,
    cursorBlink: cfg.terminal.cursor_blink,
    cursorStyle: cfg.terminal.cursor_style,
    theme: {
      background: "#0a0a0a",
      foreground: "#e8e8e8",
      cursor: "#d4a85c",
      selectionBackground: "#d4a85c33",
    },
    scrollback: cfg.terminal.scrollback_lines,
    allowProposedApi: true,
  });
```

- [ ] **Step 2: Write `applySettings.ts` with a pure mapper + a subscription**

```typescript
// applySettings — bridges settingsStore → live xterm Terminals. The mapper is
// pure (unit-tested); installSettingsApply wires it to store changes at boot.

import type { ITerminalOptions } from "@xterm/xterm";
import { useSettingsStore } from "@/store/settingsStore";
import { applyOptionsToAll } from "@/terminals/registry";
import type { WorkstationConfig } from "@/types/config";

/** The subset of xterm options the Settings panel controls. */
export function terminalOptionsFromConfig(
  cfg: WorkstationConfig
): Partial<ITerminalOptions> {
  return {
    fontSize: cfg.font.size,
    fontWeight: String(cfg.font.weight) as ITerminalOptions["fontWeight"],
    lineHeight: cfg.font.line_height,
    cursorStyle: cfg.terminal.cursor_style,
    cursorBlink: cfg.terminal.cursor_blink,
    scrollback: cfg.terminal.scrollback_lines,
  };
}

/** Subscribe to settingsStore and push terminal-affecting options to all live
 *  Terminals whenever they change. Returns an unsubscribe fn. Call once at boot. */
export function installSettingsApply(): () => void {
  let prev = terminalOptionsFromConfig(useSettingsStore.getState().config);
  // Apply once on install (covers config loaded before terminals existed).
  applyOptionsToAll(prev);
  return useSettingsStore.subscribe((state) => {
    const next = terminalOptionsFromConfig(state.config);
    // Cheap shallow compare so unrelated config edits don't refit terminals.
    const changed = (Object.keys(next) as (keyof typeof next)[]).some(
      (k) => next[k] !== prev[k]
    );
    if (!changed) return;
    prev = next;
    applyOptionsToAll(next);
  });
}
```

- [ ] **Step 3: Write the mapper test**

`src/terminals/applySettings.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { terminalOptionsFromConfig } from "@/terminals/applySettings";
import { defaultSettings } from "@/store/settingsStore";

describe("terminalOptionsFromConfig", () => {
  it("maps config fields onto xterm option keys", () => {
    const opts = terminalOptionsFromConfig({
      ...defaultSettings,
      font: { ...defaultSettings.font, size: 18, weight: 600, line_height: 1.5 },
      terminal: {
        ...defaultSettings.terminal,
        cursor_style: "bar",
        cursor_blink: false,
        scrollback_lines: 5000,
      },
    });
    expect(opts).toEqual({
      fontSize: 18,
      fontWeight: "600",
      lineHeight: 1.5,
      cursorStyle: "bar",
      cursorBlink: false,
      scrollback: 5000,
    });
  });
});
```

- [ ] **Step 4: Install at boot**

In `src/main.tsx`, after the initial `useSettingsStore.getState().applyConfig(cfg)` call, add:

```typescript
import { installSettingsApply } from "@/terminals/applySettings";
// ...after applyConfig(cfg):
installSettingsApply();
```

- [ ] **Step 5: Run the gates**

```bash
npm run typecheck
npm test -- --run src/terminals/applySettings.test.ts
```
Expected: mapper test passes; typecheck clean. (If `ITerminalOptions["fontWeight"]` typing is strict, cast as shown.)

- [ ] **Step 6: Commit (deferred)**

---

## Task 2.3: Wire `default_shell` config → new-pane spawn

**Files:**
- Modify: `src/lib/shellsClient.ts`
- Modify: `src/terminals/orchestrator.ts`
- Test: `src/lib/shellsClient.test.ts`

- [ ] **Step 1: Add config-id helpers + failing test**

In `src/lib/shellsClient.ts`:

```typescript
/** Stable config string for a Shell — what `default_shell` stores. */
export function shellToConfigId(s: Shell): string {
  return s.kind === "wsl" ? `wsl:${s.distro}` : s.kind;
}

/** Does a detected Shell match a `default_shell` config id? */
export function configIdMatchesShell(id: string, s: Shell): boolean {
  return shellToConfigId(s) === id;
}
```

Create `src/lib/shellsClient.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
import { shellToConfigId, configIdMatchesShell } from "@/lib/shellsClient";

describe("shell config ids", () => {
  it("uses kind for non-wsl shells", () => {
    expect(shellToConfigId({ kind: "pwsh", path: "x" })).toBe("pwsh");
    expect(shellToConfigId({ kind: "cmd", path: "x" })).toBe("cmd");
  });
  it("namespaces wsl by distro", () => {
    expect(shellToConfigId({ kind: "wsl", distro: "Ubuntu" })).toBe("wsl:Ubuntu");
  });
  it("matches a config id against a shell", () => {
    expect(configIdMatchesShell("wsl:Ubuntu", { kind: "wsl", distro: "Ubuntu" })).toBe(true);
    expect(configIdMatchesShell("pwsh", { kind: "cmd", path: "x" })).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npm test -- --run src/lib/shellsClient.test.ts
```

- [ ] **Step 3: Use the config default in the orchestrator's default-shell resolver**

Read `src/terminals/orchestrator.ts` around the cached-shells / default-shell logic (the `detectShells` cache near lines 37–80). Locate the function that picks the shell for a freshly-spawned pane (the one the implementer note at ~line 66 references). Update it to prefer the configured default:

```typescript
import { configIdMatchesShell } from "@/lib/shellsClient";
import { useSettingsStore } from "@/store/settingsStore";

// inside the default-shell resolver, given the cached `shells: Shell[]`:
const configured = useSettingsStore.getState().config.default_shell;
const match = shells.find((s) => configIdMatchesShell(configured, s));
if (match) return match;
// else fall through to the existing fallback (first detected / hardcoded pwsh).
```

> Keep the existing fallback intact — if the configured shell isn't currently detected, spawning must still succeed. Only future spawns are affected; running panes are never re-shelled (matches CONTEXT.md).

- [ ] **Step 4: Run the gates**

```bash
npm run typecheck
npm test -- --run
```

- [ ] **Step 5: Commit the Phase 2 bundle**

```bash
git add src/store/settingsStore.ts src/terminals/applySettings.ts src/terminals/applySettings.test.ts src/terminals/registry.ts src/terminals/orchestrator.ts src/lib/shellsClient.ts src/lib/shellsClient.test.ts src/main.tsx
git commit -m "feat(settings): optimistic store writes + live xterm apply + default-shell wiring"
```

---

# Phase 3 — Control primitives

All primitives share `src/components/settings/controls.module.css` and use theme tokens only. They are presentational: value in, `onChange` out. No store access inside primitives.

## Task 3.1: Primitive components

**Files:**
- Create: `src/components/settings/SettingRow.tsx`
- Create: `src/components/settings/Toggle.tsx`
- Create: `src/components/settings/Stepper.tsx`
- Create: `src/components/settings/Dropdown.tsx`
- Create: `src/components/settings/Segmented.tsx`
- Create: `src/components/settings/ChipList.tsx`
- Create: `src/components/settings/controls.module.css`

- [ ] **Step 1: Write `SettingRow.tsx`**

```tsx
import type { ReactNode } from "react";
import styles from "@/components/settings/controls.module.css";

export function SettingRow({
  label,
  description,
  control,
}: {
  label: string;
  description?: string;
  control: ReactNode;
}) {
  return (
    <div className={styles.row}>
      <div className={styles.rowText}>
        <span className={styles.rowLabel}>{label}</span>
        {description && <span className={styles.rowDesc}>{description}</span>}
      </div>
      <div className={styles.rowControl}>{control}</div>
    </div>
  );
}
```

- [ ] **Step 2: Write `Toggle.tsx`**

```tsx
import styles from "@/components/settings/controls.module.css";

export function Toggle({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      className={`${styles.toggle} ${checked ? styles.toggleOn : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span className={styles.toggleKnob} />
    </button>
  );
}
```

- [ ] **Step 3: Write `Stepper.tsx`**

```tsx
import styles from "@/components/settings/controls.module.css";

export function Stepper({
  value,
  min,
  max,
  step = 1,
  onChange,
  ariaLabel,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (next: number) => void;
  ariaLabel: string;
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  // Round to the step grid so float steps (e.g. 0.1) don't accumulate error.
  const round = (n: number) => Math.round(n / step) * step;
  return (
    <div className={styles.stepper} aria-label={ariaLabel}>
      <button
        type="button"
        className={styles.stepperBtn}
        aria-label="Decrease"
        disabled={value <= min}
        onClick={() => onChange(clamp(round(value - step)))}
      >
        −
      </button>
      <span className={styles.stepperValue}>{Number(value.toFixed(2))}</span>
      <button
        type="button"
        className={styles.stepperBtn}
        aria-label="Increase"
        disabled={value >= max}
        onClick={() => onChange(clamp(round(value + step)))}
      >
        +
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Write `Dropdown.tsx`**

```tsx
import styles from "@/components/settings/controls.module.css";

export interface DropdownOption {
  value: string;
  label: string;
}

export function Dropdown({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: string;
  options: DropdownOption[];
  onChange: (next: string) => void;
  ariaLabel: string;
}) {
  return (
    <select
      className={styles.dropdown}
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
```

- [ ] **Step 5: Write `Segmented.tsx`**

```tsx
import styles from "@/components/settings/controls.module.css";

export interface SegmentOption {
  value: string;
  label: string;
}

export function Segmented({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: string;
  options: SegmentOption[];
  onChange: (next: string) => void;
  ariaLabel: string;
}) {
  return (
    <div className={styles.segmented} role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          className={`${styles.segment} ${value === o.value ? styles.segmentOn : ""}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Write `ChipList.tsx`**

```tsx
import { useState } from "react";
import styles from "@/components/settings/controls.module.css";

export function ChipList({
  values,
  onChange,
  placeholder = "Add…",
  ariaLabel,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  ariaLabel: string;
}) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const v = draft.trim();
    if (v && !values.includes(v)) onChange([...values, v]);
    setDraft("");
  };
  return (
    <div className={styles.chipList} aria-label={ariaLabel}>
      <div className={styles.chips}>
        {values.map((v) => (
          <span key={v} className={styles.chip}>
            {v}
            <button
              type="button"
              className={styles.chipRemove}
              aria-label={`Remove ${v}`}
              onClick={() => onChange(values.filter((x) => x !== v))}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <input
        className={styles.chipInput}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
      />
    </div>
  );
}
```

- [ ] **Step 7: Write `controls.module.css`**

Use tokens only. Mirrors existing micro-interaction conventions (`--dur-fast var(--ease-out)`, `--accent` for active, `--bg-2`/`--bg-3` surfaces).

```css
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-2) 0;
}
.rowText { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.rowLabel { font-size: 13px; color: var(--fg-0); }
.rowDesc { font-size: 11px; color: var(--fg-2); }
.rowControl { flex-shrink: 0; }

/* Toggle */
.toggle {
  width: 34px; height: 18px; border-radius: 9px;
  background: var(--bg-3); border: 1px solid var(--border);
  position: relative; cursor: pointer; padding: 0;
  transition: background var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
}
.toggleOn { background: var(--accent); border-color: var(--accent); }
.toggleKnob {
  position: absolute; top: 1px; left: 1px; width: 14px; height: 14px;
  border-radius: 50%; background: var(--fg-0);
  transition: transform var(--dur-fast) var(--ease-out);
}
.toggleOn .toggleKnob { transform: translateX(16px); background: var(--bg-0); }

/* Stepper */
.stepper { display: inline-flex; align-items: center; gap: 2px; }
.stepperBtn {
  width: 24px; height: 24px; border-radius: var(--radius-sm);
  background: var(--bg-2); border: 1px solid var(--border); color: var(--fg-0);
  cursor: pointer; font-size: 14px; line-height: 1;
  transition: background var(--dur-fast) var(--ease-out);
}
.stepperBtn:hover:not(:disabled) { background: var(--bg-3); }
.stepperBtn:disabled { opacity: 0.4; cursor: default; }
.stepperValue { min-width: 40px; text-align: center; font-size: 13px; color: var(--fg-0); font-family: var(--font-mono); }

/* Dropdown */
.dropdown {
  background: var(--bg-2); color: var(--fg-0); border: 1px solid var(--border);
  border-radius: var(--radius-sm); padding: 4px 8px; font-family: var(--font-ui);
  font-size: 13px; cursor: pointer; min-width: 140px;
}
.dropdown:hover { background: var(--bg-3); }

/* Segmented */
.segmented { display: inline-flex; border: 1px solid var(--border); border-radius: var(--radius-sm); overflow: hidden; }
.segment {
  background: var(--bg-2); color: var(--fg-1); border: none; padding: 4px 10px;
  font-family: var(--font-ui); font-size: 12px; cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}
.segment + .segment { border-left: 1px solid var(--border); }
.segment:hover { background: var(--bg-3); color: var(--fg-0); }
.segmentOn { background: var(--accent); color: var(--bg-0); }
.segmentOn:hover { background: var(--accent); color: var(--bg-0); }

/* ChipList */
.chipList { display: flex; flex-direction: column; gap: 6px; align-items: flex-end; }
.chips { display: flex; flex-wrap: wrap; gap: 4px; justify-content: flex-end; max-width: 320px; }
.chip {
  display: inline-flex; align-items: center; gap: 4px;
  background: var(--bg-2); border: 1px solid var(--border); border-radius: var(--radius-sm);
  padding: 1px 4px 1px 8px; font-size: 12px; color: var(--fg-0); font-family: var(--font-mono);
}
.chipRemove { background: transparent; border: none; color: var(--fg-2); cursor: pointer; font-size: 13px; line-height: 1; }
.chipRemove:hover { color: var(--fg-0); }
.chipInput {
  background: var(--bg-2); border: 1px solid var(--border); border-radius: var(--radius-sm);
  padding: 4px 8px; font-family: var(--font-ui); font-size: 13px; color: var(--fg-0); width: 160px;
}
.chipInput:focus-visible { outline: 1px solid var(--accent); border-color: var(--accent); }
```

- [ ] **Step 8: Typecheck**

```bash
npm run typecheck
```
Expected: clean.

- [ ] **Step 9: Commit (deferred — bundles with Phase 3 tests)**

---

## Task 3.2: Primitive tests

**Files:**
- Create: `src/components/settings/controls.test.tsx`

- [ ] **Step 1: Write render + emit tests**

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Toggle } from "@/components/settings/Toggle";
import { Stepper } from "@/components/settings/Stepper";
import { Segmented } from "@/components/settings/Segmented";
import { Dropdown } from "@/components/settings/Dropdown";
import { ChipList } from "@/components/settings/ChipList";

describe("Toggle", () => {
  it("emits the flipped value on click", () => {
    const onChange = vi.fn();
    render(<Toggle checked={false} onChange={onChange} ariaLabel="t" />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});

describe("Stepper", () => {
  it("clamps at max and rounds to the step grid", () => {
    const onChange = vi.fn();
    render(<Stepper value={2.0} min={1} max={2} step={0.1} onChange={onChange} ariaLabel="s" />);
    fireEvent.click(screen.getByLabelText("Increase")); // disabled at max — no emit
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Decrease"));
    expect(onChange).toHaveBeenCalledWith(1.9);
  });
});

describe("Segmented", () => {
  it("emits the chosen segment", () => {
    const onChange = vi.fn();
    render(
      <Segmented
        value="block"
        options={[
          { value: "bar", label: "Bar" },
          { value: "block", label: "Block" },
        ]}
        onChange={onChange}
        ariaLabel="cursor"
      />
    );
    fireEvent.click(screen.getByText("Bar"));
    expect(onChange).toHaveBeenCalledWith("bar");
  });
});

describe("Dropdown", () => {
  it("emits the selected value", () => {
    const onChange = vi.fn();
    render(
      <Dropdown
        value="a"
        options={[
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ]}
        onChange={onChange}
        ariaLabel="d"
      />
    );
    fireEvent.change(screen.getByLabelText("d"), { target: { value: "b" } });
    expect(onChange).toHaveBeenCalledWith("b");
  });
});

describe("ChipList", () => {
  it("adds a chip on Enter and removes on ×", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ChipList values={["node_modules"]} onChange={onChange} ariaLabel="dirs" />
    );
    const input = screen.getByLabelText("dirs").querySelector("input")!;
    fireEvent.change(input, { target: { value: "dist" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(["node_modules", "dist"]);

    onChange.mockClear();
    rerender(<ChipList values={["node_modules"]} onChange={onChange} ariaLabel="dirs" />);
    fireEvent.click(screen.getByLabelText("Remove node_modules"));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});
```

> `@testing-library/react` is already used by `SessionsSidebar.test.tsx` / `TopBar.test.tsx`. If `fireEvent.blur` double-fires `add` in the ChipList Enter test, the test only asserts the Enter call — blur on an already-cleared draft is a no-op (empty draft). Confirmed safe by the `if (v && …)` guard.

- [ ] **Step 2: Run — expect PASS**

```bash
npm test -- --run src/components/settings/controls.test.tsx
```

- [ ] **Step 3: Commit the Phase 3 bundle**

```bash
git add src/components/settings/
git commit -m "feat(settings): control primitives (toggle/stepper/dropdown/segmented/chips)"
```

---

# Phase 4 — SettingsModal + wiring

## Task 4.1: `settingsModalStore`

**Files:**
- Create: `src/store/settingsModalStore.ts`

- [ ] **Step 1: Write the store**

```typescript
// settingsModalStore — open/close + active category for the Settings panel.
// Mirrors shortcutsModalStore; intentionally tiny (no immer/persist).

import { create } from "zustand";

export type SettingsCategory = "appearance" | "terminal" | "editor" | "sidebar";

interface State {
  open: boolean;
  category: SettingsCategory;
}
interface Actions {
  openModal: () => void;
  closeModal: () => void;
  setCategory: (c: SettingsCategory) => void;
}

export const useSettingsModalStore = create<State & Actions>((set) => ({
  open: false,
  category: "appearance",
  openModal: () => set({ open: true }),
  closeModal: () => set({ open: false }),
  setCategory: (category) => set({ category }),
}));
```

- [ ] **Step 2: Typecheck + commit (deferred)**

```bash
npm run typecheck
```

---

## Task 4.2: `SettingsModal` component + CSS

**Files:**
- Create: `src/components/SettingsModal.tsx`
- Create: `src/components/SettingsModal.module.css`

- [ ] **Step 1: Write `SettingsModal.module.css`**

Copy the backdrop/modal/header/closeBtn transition blocks from `ShortcutsModal.module.css` verbatim (motion consistency), then add the rail + content layout:

```css
/* Backdrop + modal + header + closeBtn: identical to ShortcutsModal.module.css */
.backdrop {
  position: fixed; inset: 0; background: rgba(0, 0, 0, 0.5); z-index: var(--z-modal);
  display: flex; align-items: center; justify-content: center;
  opacity: 1; transition: opacity var(--dur-base) var(--ease-out);
}
.backdrop[data-state="closed"] { opacity: 0; transition-duration: var(--dur-fast); transition-timing-function: var(--ease-in); }
.modal {
  background: var(--bg-1); border: 1px solid var(--border); border-radius: var(--radius-md);
  font-family: var(--font-ui); color: var(--fg-0);
  width: min(720px, calc(100vw - 64px)); height: min(560px, calc(100vh - 96px));
  display: flex; flex-direction: column; box-shadow: 0 4px 16px rgba(0, 0, 0, 0.6);
  opacity: 1; transform: scale(1); transform-origin: center;
  transition: opacity var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-out);
}
.backdrop[data-state="closed"] .modal { opacity: 0; transform: scale(0.97); transition-duration: var(--dur-fast); transition-timing-function: var(--ease-in); }
.header {
  padding: var(--space-3); border-bottom: 1px solid var(--border);
  font-size: 13px; color: var(--fg-heading); font-weight: 600;
  display: flex; align-items: center; justify-content: space-between;
}
.closeBtn {
  width: 24px; height: 24px; background: transparent; color: var(--fg-1);
  border: 1px solid transparent; border-radius: var(--radius-sm); cursor: pointer; font-size: 14px;
}
.closeBtn:hover { color: var(--fg-0); background: var(--bg-2); border-color: var(--accent-dim); }

/* Body: rail + content */
.body { display: flex; flex: 1; min-height: 0; }
.rail {
  width: 160px; flex-shrink: 0; border-right: 1px solid var(--border);
  padding: var(--space-2); display: flex; flex-direction: column; gap: 2px;
}
.railItem {
  text-align: left; background: transparent; border: none; border-radius: var(--radius-sm);
  color: var(--fg-1); font-family: var(--font-ui); font-size: 13px; padding: 6px 10px; cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out), color var(--dur-fast) var(--ease-out);
}
.railItem:hover { background: var(--bg-2); color: var(--fg-0); }
.railItemActive { background: var(--bg-3); color: var(--fg-0); font-weight: 600; }

.content { flex: 1; overflow-y: auto; padding: var(--space-3) var(--space-4); }
.sectionTitle { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--fg-2); margin-bottom: var(--space-2); }

.footer {
  padding: var(--space-2) var(--space-3); border-top: 1px solid var(--border);
  display: flex; justify-content: flex-end;
}
.footerLink {
  background: transparent; border: none; color: var(--fg-1); font-family: var(--font-ui);
  font-size: 12px; cursor: pointer; text-decoration: underline;
}
.footerLink:hover { color: var(--accent); }

/* Accent swatches (display-only placeholder) */
.swatches { display: inline-flex; gap: 6px; }
.swatch { width: 20px; height: 20px; border-radius: 50%; border: 2px solid transparent; cursor: pointer; }
.swatchActive { border-color: var(--fg-0); }
.swatchDisabled { opacity: 0.35; cursor: not-allowed; }
```

- [ ] **Step 2: Write `SettingsModal.tsx`**

```tsx
// SettingsModal — GUI editor over config.toml. Reads settingsStore; writes via
// setConfigValue (optimistic + format-preserving disk write). Motion + overlay
// pattern identical to ShortcutsModal (usePresence + data-state).

import { useEffect } from "react";

import styles from "@/components/SettingsModal.module.css";
import { usePresence } from "@/hooks/usePresence";
import { useSettingsModalStore, type SettingsCategory } from "@/store/settingsModalStore";
import { useSettingsStore } from "@/store/settingsStore";
import { SettingRow } from "@/components/settings/SettingRow";
import { Toggle } from "@/components/settings/Toggle";
import { Stepper } from "@/components/settings/Stepper";
import { Dropdown } from "@/components/settings/Dropdown";
import { Segmented } from "@/components/settings/Segmented";
import { ChipList } from "@/components/settings/ChipList";
import { configFilePath } from "@/lib/configClient";
import { useMdStore } from "@/store/mdStore";
import { detectShells, shellLabel, shellToConfigId } from "@/lib/shellsClient";
import { useEffect as useReactEffect, useState } from "react";
import type { Shell } from "@/types";

const CATEGORIES: { id: SettingsCategory; label: string }[] = [
  { id: "appearance", label: "Appearance" },
  { id: "terminal", label: "Terminal" },
  { id: "editor", label: "Editor" },
  { id: "sidebar", label: "Sidebar" },
];

// Accent presets: only "amber" is live in v0.1. Others are display-only.
const ACCENT_PRESETS = [
  { id: "amber", color: "#d4a85c", enabled: true },
  { id: "blue", color: "#5c8fd4", enabled: false },
  { id: "green", color: "#7fc26b", enabled: false },
  { id: "magenta", color: "#c46bbf", enabled: false },
  { id: "red", color: "#d45c5c", enabled: false },
];

export function SettingsModal() {
  const open = useSettingsModalStore((s) => s.open);
  const close = useSettingsModalStore((s) => s.closeModal);
  const category = useSettingsModalStore((s) => s.category);
  const setCategory = useSettingsModalStore((s) => s.setCategory);
  const { mounted, state } = usePresence(open, 160);

  const config = useSettingsStore((s) => s.config);
  const set = useSettingsStore((s) => s.setConfigValue);

  const [shells, setShells] = useState<Shell[]>([]);
  useReactEffect(() => {
    if (!open) return;
    void detectShells().then(setShells).catch(() => setShells([]));
  }, [open]);

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

  if (!mounted) return null;

  const openRawConfig = () => {
    void configFilePath().then((p) => useMdStore.getState().openMdTab(p));
    close();
  };

  return (
    <div
      className={styles.backdrop}
      data-state={state}
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
    >
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header} id="settings-modal-title">
          Settings
          <button className={styles.closeBtn} onClick={close} aria-label="Close settings" title="Close (Esc)">
            ×
          </button>
        </div>

        <div className={styles.body}>
          <nav className={styles.rail} aria-label="Settings categories">
            {CATEGORIES.map((c) => (
              <button
                key={c.id}
                className={`${styles.railItem} ${category === c.id ? styles.railItemActive : ""}`}
                onClick={() => setCategory(c.id)}
              >
                {c.label}
              </button>
            ))}
          </nav>

          <div className={styles.content}>
            {category === "appearance" && (
              <>
                <SettingRow
                  label="Accent"
                  description="Theme accent. More presets arrive in v0.2."
                  control={
                    <div className={styles.swatches}>
                      {ACCENT_PRESETS.map((p) => (
                        <button
                          key={p.id}
                          className={`${styles.swatch} ${
                            config.theme.accent === p.id ? styles.swatchActive : ""
                          } ${!p.enabled ? styles.swatchDisabled : ""}`}
                          style={{ background: p.color }}
                          disabled={!p.enabled}
                          title={p.enabled ? p.id : `${p.id} — coming in v0.2`}
                          aria-label={p.enabled ? p.id : `${p.id} (coming in v0.2)`}
                          onClick={() => p.enabled && set("theme.accent", p.id)}
                        />
                      ))}
                    </div>
                  }
                />
                <SettingRow
                  label="Font family"
                  control={
                    <Dropdown
                      ariaLabel="Font family"
                      value={config.font.family}
                      options={[
                        { value: "JetBrains Mono", label: "JetBrains Mono" },
                        { value: "Consolas", label: "Consolas" },
                        { value: "Cascadia Code", label: "Cascadia Code" },
                        { value: "Fira Code", label: "Fira Code" },
                      ]}
                      onChange={(v) => set("font.family", v)}
                    />
                  }
                />
                <SettingRow
                  label="Font size"
                  control={
                    <Stepper
                      ariaLabel="Font size"
                      value={config.font.size}
                      min={8}
                      max={32}
                      onChange={(v) => set("font.size", v)}
                    />
                  }
                />
                <SettingRow
                  label="Font weight"
                  control={
                    <Dropdown
                      ariaLabel="Font weight"
                      value={String(config.font.weight)}
                      options={[
                        { value: "300", label: "Light (300)" },
                        { value: "400", label: "Regular (400)" },
                        { value: "500", label: "Medium (500)" },
                        { value: "600", label: "Semibold (600)" },
                      ]}
                      onChange={(v) => set("font.weight", Number(v))}
                    />
                  }
                />
                <SettingRow
                  label="Line height"
                  control={
                    <Stepper
                      ariaLabel="Line height"
                      value={config.font.line_height}
                      min={1.0}
                      max={2.0}
                      step={0.1}
                      onChange={(v) => set("font.line_height", v)}
                    />
                  }
                />
                <SettingRow
                  label="Cursor shape"
                  control={
                    <Segmented
                      ariaLabel="Cursor shape"
                      value={config.terminal.cursor_style}
                      options={[
                        { value: "bar", label: "Bar" },
                        { value: "block", label: "Block" },
                        { value: "underline", label: "Underline" },
                      ]}
                      onChange={(v) => set("terminal.cursor_style", v)}
                    />
                  }
                />
                <SettingRow
                  label="Cursor blink"
                  control={
                    <Toggle
                      ariaLabel="Cursor blink"
                      checked={config.terminal.cursor_blink}
                      onChange={(v) => set("terminal.cursor_blink", v)}
                    />
                  }
                />
              </>
            )}

            {category === "terminal" && (
              <>
                <SettingRow
                  label="Default shell"
                  description="Shell for new sessions. Running terminals are unchanged."
                  control={
                    <Dropdown
                      ariaLabel="Default shell"
                      value={config.default_shell}
                      options={
                        shells.length
                          ? shells.map((s) => ({ value: shellToConfigId(s), label: shellLabel(s) }))
                          : [{ value: config.default_shell, label: config.default_shell }]
                      }
                      onChange={(v) => set("default_shell", v)}
                    />
                  }
                />
                <SettingRow
                  label="Scrollback lines"
                  control={
                    <Stepper
                      ariaLabel="Scrollback lines"
                      value={config.terminal.scrollback_lines}
                      min={1000}
                      max={100000}
                      step={1000}
                      onChange={(v) => set("terminal.scrollback_lines", v)}
                    />
                  }
                />
              </>
            )}

            {category === "editor" && (
              <>
                <SettingRow
                  label="Default mode"
                  control={
                    <Segmented
                      ariaLabel="Default mode"
                      value={config.md_editor.default_mode}
                      options={[
                        { value: "view", label: "View" },
                        { value: "edit", label: "Edit" },
                      ]}
                      onChange={(v) => set("md_editor.default_mode", v)}
                    />
                  }
                />
                <SettingRow
                  label="Soft wrap"
                  control={
                    <Toggle
                      ariaLabel="Soft wrap"
                      checked={config.md_editor.soft_wrap}
                      onChange={(v) => set("md_editor.soft_wrap", v)}
                    />
                  }
                />
                <SettingRow
                  label="Line numbers"
                  control={
                    <Toggle
                      ariaLabel="Line numbers"
                      checked={config.md_editor.line_numbers}
                      onChange={(v) => set("md_editor.line_numbers", v)}
                    />
                  }
                />
                <SettingRow
                  label="Trim trailing whitespace on save"
                  control={
                    <Toggle
                      ariaLabel="Trim trailing whitespace on save"
                      checked={config.md_editor.trim_trailing_whitespace_on_save}
                      onChange={(v) => set("md_editor.trim_trailing_whitespace_on_save", v)}
                    />
                  }
                />
              </>
            )}

            {category === "sidebar" && (
              <SettingRow
                label="Collapsed directories"
                description="Folders rendered collapsed by default to skip huge trees."
                control={
                  <ChipList
                    ariaLabel="Collapsed directories"
                    values={config.sidebar.collapsed_dirs}
                    onChange={(v) => set("sidebar.collapsed_dirs", v)}
                  />
                }
              />
            )}
          </div>
        </div>

        <div className={styles.footer}>
          <button className={styles.footerLink} onClick={openRawConfig}>
            Edit config.toml directly
          </button>
        </div>
      </div>
    </div>
  );
}
```

> Merge the two `useEffect`/`useState` imports into one `import { useEffect, useState } from "react";` line — the duplicate-aliased imports above are only for clarity in the plan. Verify `useMdStore` exposes `openMdTab` (TopBar already uses an `openMdTab`); match its actual call site.

- [ ] **Step 3: Typecheck**

```bash
npm run typecheck
```
Expected: clean (fix the import merge noted above).

- [ ] **Step 4: Commit (deferred)**

---

## Task 4.3: Mount + open triggers (gear, Ctrl+,)

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/TopBar.tsx`
- Modify: `src/hooks/useKeyboardShortcuts.ts`

- [ ] **Step 1: Mount the modal in `App.tsx`**

Add the import and render it beside the other overlays (next to `<ShortcutsModal />`):

```tsx
import { SettingsModal } from "@/components/SettingsModal";
// ...
      <ShortcutsModal />
      <SettingsModal />
```

- [ ] **Step 2: Point the gear at the modal**

In `src/components/TopBar.tsx`, replace the body of `onSettings` (currently opens the MD tab) with opening the modal:

```tsx
import { useSettingsModalStore } from "@/store/settingsModalStore";

const onSettings = () => {
  useSettingsModalStore.getState().openModal();
};
```

(The raw-file path is preserved via the modal's "Edit config.toml directly" footer link.) Update the gear button `title` to `"Settings (Ctrl+,)"`.

- [ ] **Step 3: Bind Ctrl+,**

In `src/hooks/useKeyboardShortcuts.ts`, add an entry to the SHORTCUTS array near the other surface toggles. `isCtrlOnly` already exists (used by the session shortcuts):

```typescript
import { useSettingsModalStore } from "@/store/settingsModalStore";

// Ctrl+, — open Settings (universal settings convention).
{
  match: (e) => isCtrlOnly(e) && e.key === ",",
  run: () => {
    useSettingsModalStore.getState().openModal();
    return true;
  },
},
```

- [ ] **Step 4: Run the gates**

```bash
npm run typecheck
npm test -- --run
```
Expected: all green. (The TopBar drag-region test asserts every clickable control has `data-tauri-drag-region="false"`; the gear button is unchanged structurally, so the count is unaffected.)

- [ ] **Step 5: Commit the Phase 4 bundle**

```bash
git add src/store/settingsModalStore.ts src/components/SettingsModal.tsx src/components/SettingsModal.module.css src/App.tsx src/components/TopBar.tsx src/hooks/useKeyboardShortcuts.ts
git commit -m "feat(settings): SettingsModal panel + gear/Ctrl+, triggers"
```

---

# Phase 5 — Verification + review

## Task 5.1: Full suite + manual smoke

- [ ] **Step 1: Run every gate**

```bash
npm run typecheck
npm test -- --run
cargo test --lib --manifest-path src-tauri/Cargo.toml
cargo clippy --all-targets --manifest-path src-tauri/Cargo.toml -- -D warnings
cargo fmt --all --manifest-path src-tauri/Cargo.toml -- --check
```
Expected: all green. Vitest count up by the new control/store/mapper/shell tests; cargo up by the new config tests.

- [ ] **Step 2: Manual smoke (via `npm run tauri dev` / the run skill)**
  - Click ⚙ and press Ctrl+, — modal animates in like ShortcutsModal; Esc/backdrop close.
  - Change Font size and Cursor shape → live terminals update with no respawn.
  - Toggle a couple editor toggles → values stick.
  - Open `config.toml` on disk → only the changed keys differ; comments + `[keybindings]` intact.
  - Externally edit `config.toml` (e.g. font size) and save → panel reflects it (hot-reload reconcile).
  - Click "Edit config.toml directly" → opens the file in an MD tab.

## Task 5.2: Code review

- [ ] Dispatch the code-review skill (or `/review`) over the full diff (`git diff <first-phase-1-commit>^..HEAD`) checking:
  - All colours/durations via tokens (no raw hex except the accent-preset swatches, which are intentional display constants).
  - Motion matches ShortcutsModal (usePresence 160ms, data-state, scale 0.97).
  - `set_config_value` preserves comments + `[keybindings]`; rejects unknown roots.
  - Optimistic-then-revert path correct; error toast on write failure.
  - Live-apply refits terminals after font/line-height change.
  - No PTY bytes / non-serializable handles in any store (DESIGN.md §4).
  - Accent presets are display-only; non-amber writes nothing.

---

# Self-review (controller, pre-save)

- [x] Every task references exact file paths.
- [x] Every code step shows actual code (no "similar to Task N").
- [x] Test commands include exact invocations + expected result.
- [x] Spec coverage: schema additions (1.1), write path (1.2/1.3), optimistic store (2.1), live-apply (2.2), default-shell (2.3), primitives (3.x), modal+triggers (4.x), accent placeholder (4.2), raw-file link (4.2), verification + review (5.x).
- [x] Type consistency: `setConfigValue(path, value)` signature identical across configClient / settingsStore / usages; `cursor_style` union matches Rust string + Segmented options; `shellToConfigId` used in both dropdown + orchestrator.
- [x] Commits bundled per phase (5 commits).
- [x] Motion/UI consistency mandated against ShortcutsModal + existing tokens (spec §7).

---

# What's NOT in this plan (deferred, per spec §2)

- Low-value knobs (`indent_spaces`, `ipc_batch_ms`, `ring_buffer_mb`, `log.*`, `quick_viewer.width_pct`, `sidebar.visible`) stay file-only.
- Theme/accent switching logic (only the placeholder UI ships).
- Full `[keybindings]` editor.
- Per-profile settings, light/dark sync, font ligatures, theme import/export.
