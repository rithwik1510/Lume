// SettingsModal — GUI editor over config.toml. Reads settingsStore; writes via
// setConfigValue (optimistic + format-preserving disk write). Motion + overlay
// pattern identical to ShortcutsModal (usePresence + data-state).

import { useEffect, useState } from "react";

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
  useEffect(() => {
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
                          className={`${styles.swatch} ${config.theme.accent === p.id ? styles.swatchActive : ""} ${!p.enabled ? styles.swatchDisabled : ""}`}
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
                <SettingRow label="Font family" control={
                  <Dropdown ariaLabel="Font family" value={config.font.family}
                    options={[
                      { value: "JetBrains Mono", label: "JetBrains Mono" },
                      { value: "Consolas", label: "Consolas" },
                      { value: "Cascadia Code", label: "Cascadia Code" },
                      { value: "Fira Code", label: "Fira Code" },
                    ]}
                    onChange={(v) => set("font.family", v)} />
                } />
                <SettingRow label="Font size" control={
                  <Stepper ariaLabel="Font size" value={config.font.size} min={8} max={32}
                    onChange={(v) => set("font.size", v)} />
                } />
                <SettingRow label="Font weight" control={
                  <Dropdown ariaLabel="Font weight" value={String(config.font.weight)}
                    options={[
                      { value: "300", label: "Light (300)" },
                      { value: "400", label: "Regular (400)" },
                      { value: "500", label: "Medium (500)" },
                      { value: "600", label: "Semibold (600)" },
                    ]}
                    onChange={(v) => set("font.weight", Number(v))} />
                } />
                <SettingRow label="Line height" control={
                  <Stepper ariaLabel="Line height" value={config.font.line_height} min={1.0} max={2.0} step={0.1}
                    onChange={(v) => set("font.line_height", v)} />
                } />
                <SettingRow label="Cursor shape" control={
                  <Segmented ariaLabel="Cursor shape" value={config.terminal.cursor_style}
                    options={[
                      { value: "bar", label: "Bar" },
                      { value: "block", label: "Block" },
                      { value: "underline", label: "Underline" },
                    ]}
                    onChange={(v) => set("terminal.cursor_style", v)} />
                } />
                <SettingRow label="Cursor blink" control={
                  <Toggle ariaLabel="Cursor blink" checked={config.terminal.cursor_blink}
                    onChange={(v) => set("terminal.cursor_blink", v)} />
                } />
              </>
            )}

            {category === "terminal" && (
              <>
                <SettingRow label="Default shell" description="Shell for new sessions. Running terminals are unchanged."
                  control={
                    <Dropdown ariaLabel="Default shell" value={config.default_shell}
                      options={shells.length ? shells.map((s) => ({ value: shellToConfigId(s), label: shellLabel(s) })) : [{ value: config.default_shell, label: config.default_shell }]}
                      onChange={(v) => set("default_shell", v)} />
                  } />
                <SettingRow label="Scrollback lines" control={
                  <Stepper ariaLabel="Scrollback lines" value={config.terminal.scrollback_lines} min={1000} max={100000} step={1000}
                    onChange={(v) => set("terminal.scrollback_lines", v)} />
                } />
              </>
            )}

            {category === "editor" && (
              <>
                <SettingRow label="Default mode" control={
                  <Segmented ariaLabel="Default mode" value={config.md_editor.default_mode}
                    options={[{ value: "view", label: "View" }, { value: "edit", label: "Edit" }]}
                    onChange={(v) => set("md_editor.default_mode", v)} />
                } />
                <SettingRow label="Soft wrap" control={
                  <Toggle ariaLabel="Soft wrap" checked={config.md_editor.soft_wrap}
                    onChange={(v) => set("md_editor.soft_wrap", v)} />
                } />
                <SettingRow label="Line numbers" control={
                  <Toggle ariaLabel="Line numbers" checked={config.md_editor.line_numbers}
                    onChange={(v) => set("md_editor.line_numbers", v)} />
                } />
                <SettingRow label="Trim trailing whitespace on save" control={
                  <Toggle ariaLabel="Trim trailing whitespace on save" checked={config.md_editor.trim_trailing_whitespace_on_save}
                    onChange={(v) => set("md_editor.trim_trailing_whitespace_on_save", v)} />
                } />
              </>
            )}

            {category === "sidebar" && (
              <SettingRow label="Collapsed directories" description="Folders rendered collapsed by default to skip huge trees."
                control={
                  <ChipList ariaLabel="Collapsed directories" values={config.sidebar.collapsed_dirs}
                    onChange={(v) => set("sidebar.collapsed_dirs", v)} />
                } />
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
