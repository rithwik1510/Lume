# Settings UI — Design Spec

**Status:** DRAFT (post-brainstorming)
**Date:** 2026-05-26
**Supersedes:** the v0.1 stance in DESIGN.md §6 / CONTEXT.md ("the file IS the settings UI"). The raw-file path is preserved, not removed — the GUI becomes a second, friendly editor of the same `config.toml`.

---

## 1. Goal

Give the ⚙ gear a real Settings panel: a GUI with toggles, dropdowns, steppers, and chip lists for the **high- and medium-value** options that already live in `config.toml`, plus a small set of new appearance options (cursor + typography) that competitors lead with and we currently hardcode.

The panel is **file-first**: it reads from and writes to `~/.workstation/config.toml`, which already hot-reloads via the `notify` watcher. The GUI and the file are the same source of truth and can never disagree. A "Edit config.toml directly" affordance preserves the power-user path.

---

## 2. Scope

### In scope
- A centered modal `SettingsModal`, opened by the ⚙ gear and `Ctrl+,`, dismissed by Esc / backdrop / close button.
- Four categories (Appearance · Terminal · Editor · Sidebar) with a left-rail navigation and a scrollable control pane.
- Surfacing the high- (⭐⭐⭐) and medium- (⭐⭐) value config fields as controls (inventory in §4).
- New config fields: `font.weight`, `font.line_height`, `terminal.cursor_style`, `terminal.cursor_blink` — added to the schema and **wired to live xterm terminals**.
- Closing the existing live-apply gap: `registry.ts` currently hardcodes `fontSize`, `lineHeight`, `cursorBlink`, `cursorStyle`. These (and `font.family`/`font.size`) start flowing from `settingsStore`.
- A format-preserving write path (`set_config_value` Tauri command via the `toml_edit` crate) that edits only the changed key and leaves comments, `[keybindings]`, and unmodelled keys intact.
- A footer "Edit config.toml" link that opens the raw file in an MD Editor tab (today's gear behaviour).

### Out of scope (deferred)
- **Low-value (⭐) fields** stay file-only for now: `md_editor.indent_spaces`, `terminal.ipc_batch_ms`, `terminal.ring_buffer_mb`, `log.level`, `log.path`, `quick_viewer.width_pct`, `sidebar.visible`.
- **Theme/accent switching.** Only `amber` exists in v0.1. The accent control is rendered as a **forward-looking placeholder**: the amber swatch is active/selected; the five v0.2 presets render disabled with a "Coming in v0.2" affordance. Selecting a non-amber preset writes nothing.
- Full `[keybindings]` editor (its own feature later).
- Per-profile settings, light/dark OS sync, theme import/export, font ligatures.

---

## 3. Locked decisions (from brainstorming)

| Question | Decision |
|---|---|
| Form factor | **Centered modal with a left category rail** (Obsidian-style). Reuses the `ShortcutsModal`/`ConfirmDialog` overlay family for visual + motion consistency. |
| Source of truth | **`config.toml` on disk.** GUI is another editor of it. `settingsStore` mirrors the file (unchanged role). |
| Write model | **Optimistic store update + debounced format-preserving file write.** Instant live-apply; `toml_edit` writes only the changed key; watcher reload reconciles; revert + error toast on write failure. |
| Scope | High + medium value only. |
| New options | Add cursor (shape + blink) and typography (weight + line-height) to the model and wire them live. |
| Theme | Control present but display-only until v0.2. |

---

## 4. Surface & categories

### Layout
A modal (`width: min(720px, calc(100vw - 64px))`, `max-height: calc(100vh - 96px)`), split into a fixed left rail (~160px, category list) and a scrollable right pane of control rows. Header carries the title "Settings" + a close button identical to `ShortcutsModal`. Footer carries the "Edit config.toml" text button.

Each control row = `SettingRow`: a label, an optional one-line description (`--fg-2`), and the control aligned right. Same row rhythm as `ShortcutsModal`'s `.row` (label left, control right, ~`var(--space-3)` vertical padding).

### Control inventory

| Category | Setting | Config key | Control | Value |
|---|---|---|---|---|
| **Appearance** | Accent | `theme.accent` | Swatch row (amber active; 5 presets disabled, "v0.2") | ⭐⭐⭐ (display-only) |
| | Font family | `font.family` | Dropdown | ⭐⭐⭐ |
| | Font size | `font.size` | Stepper (8–32) | ⭐⭐⭐ |
| | Font weight | `font.weight` *(new)* | Dropdown (300/400/500/600) | ⭐⭐ |
| | Line height | `font.line_height` *(new)* | Stepper (1.0–2.0, step 0.1) | ⭐⭐ |
| | Cursor shape | `terminal.cursor_style` *(new)* | Segmented (Bar / Block / Underline) | ⭐⭐⭐ |
| | Cursor blink | `terminal.cursor_blink` *(new)* | Toggle | ⭐⭐⭐ |
| **Terminal** | Default shell | `default_shell` | Dropdown (detected shells via `shellsClient`) | ⭐⭐⭐ |
| | Scrollback lines | `terminal.scrollback_lines` | Number input | ⭐⭐ |
| **Editor** | Default mode | `md_editor.default_mode` | Segmented (View / Edit) | ⭐⭐ |
| | Soft wrap | `md_editor.soft_wrap` | Toggle | ⭐⭐ |
| | Line numbers | `md_editor.line_numbers` | Toggle | ⭐⭐ |
| | Trim trailing whitespace on save | `md_editor.trim_trailing_whitespace_on_save` | Toggle | ⭐⭐ |
| **Sidebar** | Collapsed directories | `sidebar.collapsed_dirs` | Chip list (add / remove) | ⭐⭐ |

---

## 5. Config schema additions

Added to `WorkstationConfig` (TS `types/config.ts`), the Rust `WorkstationConfig` struct, `defaultSettings`, and `DEFAULT_TOML`. All optional-with-default so existing `config.toml` files keep parsing (DESIGN.md §6: missing fields fall back to defaults).

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

Validation/clamping on apply: out-of-range numbers clamp to bounds; unknown `cursor_style` falls back to `"block"`. These mirror the existing "invalid values fall back" rule.

---

## 6. Data flow & write model

```
user changes a control
  └─ settingsStore.setConfigValue(path, value)        // optimistic, synchronous
       ├─ updates config in-store immediately
       ├─ applySettingsToTerminals reacts → pushes to xterm:
       │     font.size      → term.options.fontSize
       │     font.family    → term.options.fontFamily
       │     font.weight    → term.options.fontWeight / fontWeightBold
       │     font.line_height → term.options.lineHeight
       │     cursor_style   → term.options.cursorStyle
       │     cursor_blink   → term.options.cursorBlink
       │     (then refit so reflow matches new metrics)
       ├─ accent/CSS-backed values → update :root custom property
       └─ debounced 250ms → invoke set_config_value(path, value)
              └─ Rust: toml_edit loads config.toml, sets ONLY that dotted key,
                 writes back (comments / [keybindings] / unknown keys preserved)
              └─ notify watcher fires → existing reload → settingsStore reconciles
                 (idempotent: equal value = no-op render)
       └─ on invoke rejection: revert the optimistic value + push sticky error toast
```

`path` is a dotted key (e.g. `"font.size"`, `"terminal.cursor_style"`). `set_config_value` maps the dotted path onto a `toml_edit::DocumentMut`. The optimistic-then-reconcile loop is safe because the watcher reload writes an equal value (no flicker) and `config.rs` already guards against mid-write reads.

`settingsStore` keeps its existing `lastValidConfig` snapshot semantics; `setConfigValue` snapshots before the optimistic write so revert is exact.

---

## 7. UI & motion consistency (mandatory)

The panel must be indistinguishable in feel from `ShortcutsModal`. Concretely:

- **Mount/animation:** `usePresence(open, 160)`; render nothing until `mounted`; drive a `data-state={state}` attribute on the backdrop. Enter = backdrop fade (`--dur-base` / `--ease-out`) + modal `scale(0.97 → 1)`; exit = `--dur-fast` / `--ease-in`. Copy the exact `.backdrop` / `.modal` transition blocks from `ShortcutsModal.module.css`.
- **Tokens only:** colours (`--bg-0/1/2/3`, `--fg-0/1/2/heading`, `--accent`, `--accent-dim`, `--accent-alpha`, `--border`, `--error`, `--success`), geometry (`--radius-sm/md`, `--space-*`), motion (`--dur-fast/base`, `--ease-in/out`), layering (`--z-modal`). No raw hex, no ad-hoc durations.
- **Type:** `--font-ui` (Inter) for all labels/controls; `--font-mono` only for monospace-y values (e.g. chip text for dir names) if it reads better.
- **Header / close button:** reuse the `ShortcutsModal` header + `.closeBtn` styling verbatim (24×24, transparent → `--bg-2` hover, `--accent-dim` border on hover).
- **Esc / backdrop dismissal:** capture-phase keydown for Esc (wins over xterm); backdrop click closes; `stopPropagation` on the inner modal. Same as `ShortcutsModal`.
- **Control primitives** adopt existing micro-interaction conventions: hover/active transitions use `var(--dur-fast) var(--ease-out)`; focus-visible ring in `--accent`; active/checked state uses `--accent`; resting surfaces `--bg-2` with `--border`, hover `--bg-3`. The segmented control mirrors the MD-editor view/edit toggle's visual language; the toggle reads as a small track+knob in accent when on. Reduced-motion is already handled globally in `theme.css` — no per-component rules needed.
- **Left rail** active item uses the same active treatment as `SessionRow.active` (`--bg-3`, `--fg-0`, weight 600) for cross-surface familiarity.

---

## 8. Components & files

### New
| Path | Responsibility |
|---|---|
| `src/components/SettingsModal.tsx` | The panel: presence, category state, renders rows per category. |
| `src/components/SettingsModal.module.css` | Modal + rail + row layout; transitions copied from `ShortcutsModal`. |
| `src/components/settings/SettingRow.tsx` | Label + description + right-aligned control slot. |
| `src/components/settings/Toggle.tsx` | Accessible on/off switch. |
| `src/components/settings/Stepper.tsx` | Numeric −/value/+ with min/max/step. |
| `src/components/settings/Dropdown.tsx` | Native-backed select styled to theme. |
| `src/components/settings/Segmented.tsx` | 2–3 option segmented control. |
| `src/components/settings/ChipList.tsx` | Add/remove string chips (collapsed_dirs). |
| `src/components/settings/*.module.css` | Per-primitive styling on tokens. |
| `src/store/settingsModalStore.ts` | `open`, `activeCategory`, `openModal/closeModal/setCategory`. Tiny, mirrors `shortcutsModalStore`. |
| `src/components/settings/controls.test.tsx` | Render + emit tests for each primitive. |

### Modified
| Path | Change |
|---|---|
| `src/store/settingsStore.ts` | Add `setConfigValue(path, value)` (optimistic + debounced persist + revert). |
| `src/lib/configClient.ts` | Add `setConfigValue` invoke wrapper. |
| `src/types/config.ts` | Add `font.weight`, `font.line_height`, `terminal.cursor_style`, `terminal.cursor_blink`. |
| `src-tauri/src/config.rs` | Extend struct + `DEFAULT_TOML`; add `set_config_value` command (`toml_edit`). |
| `src-tauri/src/lib.rs` | Register `set_config_value` in the handler list. |
| `src-tauri/Cargo.toml` | Add `toml_edit = "0.22"`. |
| `src/terminals/applySettings.ts` *(new or folded into orchestrator)* | Subscribe to settingsStore; push font/cursor options to every live `Terminal` + refit. |
| `src/terminals/registry.ts` | Read initial font/cursor from settingsStore instead of hardcoding. |
| `src/components/TopBar.tsx` | Gear `onClick` opens `SettingsModal` (footer link keeps the raw-file path). |
| `src/hooks/useKeyboardShortcuts.ts` | Bind `Ctrl+,` → open Settings. |
| `src/App.tsx` | Mount `<SettingsModal />` beside the other overlays. |

---

## 9. Error handling

- **File-write failure:** revert the optimistic store value to the pre-change snapshot, push a sticky `error` toast (`Couldn't save settings: …`).
- **Invalid manual edits** to `config.toml` (outside the GUI): existing behaviour unchanged — warn toast + keep last-valid.
- **Shell list fetch failure:** the Default shell dropdown shows the current value as the only option (no crash).
- **Out-of-range numeric input:** clamp on commit; never persist an invalid value.

---

## 10. Testing

- **vitest** — `setConfigValue`: optimistic update applies immediately; success keeps it; rejection reverts to snapshot and toasts. Each control primitive: renders current value, emits on change, respects disabled. `applySettings`: a config change maps to the right xterm `options` keys. `settingsModalStore`: open/close/category.
- **cargo** — `set_config_value`: round-trips each new field; **preserves comments and a `[keybindings]` section** across a write; rejects unknown dotted paths; clamps/falls-back invalid `cursor_style`. Extend the existing `parse_config_or_default` tests for the new fields.
- **Manual smoke:** change font size / cursor shape and confirm live terminals update without respawn; confirm `config.toml` on disk shows only the changed key with comments intact; confirm hot-reload from an external edit still reflects in the panel.

Verification gates (every commit): `npm run typecheck`, `npm test -- --run`, `cargo test --lib`, `cargo clippy --all-targets -- -D warnings`, `cargo fmt --all -- --check`.

---

## 11. Open risks

1. **`toml_edit` dotted-path mapping.** Setting `font.size` must land in the `[font]` table, creating it if absent. Mitigation: a small helper that walks/creates tables for a dotted key; unit-tested.
2. **Live font reflow.** Changing font size/line-height changes cell metrics; terminals must refit (cols/rows recompute) or output misaligns. Mitigation: the apply effect calls the existing fit path after pushing options.
3. **Optimistic/watcher race.** A rapid series of changes + watcher reloads could momentarily reorder. Mitigation: debounce writes (250ms) and rely on equal-value idempotent reconcile; last write wins.
4. **Accent placeholder honesty.** Disabled presets must clearly read as unavailable, not broken. Mitigation: explicit "Coming in v0.2" label + disabled styling, no-op on click.

---

## 12. Acceptance

- ⚙ gear and `Ctrl+,` open an animated Settings modal matching `ShortcutsModal`'s look and motion.
- Every control in §4 reads its current value from `config.toml` and writes back format-preservingly (comments + `[keybindings]` survive).
- Font size, font family/weight, line-height, and cursor shape/blink visibly change live terminals with no respawn.
- The accent control shows amber active + the v0.2 presets disabled.
- The "Edit config.toml" link still opens the raw file in an MD tab.
- All five verification gates green.
