// src/store/settingsStore.ts
//
// Mirror of ~/.workstation/config.toml. Hot-reloads when the file changes
// on disk via the watch_config Tauri command (see configClient.watchConfig).
//
// DESIGN.md §6: "Unknown keys produce a warn toast but don't break the
// load. Invalid values fall back to last-known-valid config." We honour the
// fallback via `lastValidConfig` — every successful applyConfig snapshots
// the input. A bad parse (raised by configClient.readConfig as a Promise
// rejection) leaves the current config in place; if a downstream consumer
// chooses to call revertToLastValid we restore the snapshot.

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

import type { WorkstationConfig } from "@/types/config";

export const defaultSettings: WorkstationConfig = {
  default_shell: "pwsh",
  font: { family: "JetBrains Mono", size: 14 },
  terminal: {
    scrollback_lines: 10_000,
    ipc_batch_ms: 32,
    ring_buffer_mb: 8,
  },
  md_editor: {
    soft_wrap: true,
    line_numbers: true,
    indent_spaces: 2,
    trim_trailing_whitespace_on_save: true,
    default_mode: "view",
  },
  quick_viewer: { width_pct: 25 },
  sidebar: {
    visible: true,
    collapsed_dirs: [
      "node_modules",
      ".git",
      "__pycache__",
      "target",
      "dist",
      "build",
      ".venv",
      ".next",
      ".turbo",
      ".cache",
    ],
  },
  theme: { accent: "cobalt" },
  log: { level: "info", path: "%LOCALAPPDATA%\\workstation\\logs" },
};

interface SettingsState {
  config: WorkstationConfig;
  /** Snapshot of the last config that successfully applied. Used to recover
   *  from a bad hot-reload. */
  lastValidConfig: WorkstationConfig;
}

interface SettingsActions {
  applyConfig: (cfg: WorkstationConfig) => void;
  revertToLastValid: () => void;
  reset: () => void;
}

export type SettingsStore = SettingsState & SettingsActions;

export const useSettingsStore = create<SettingsStore>()(
  devtools(
    immer((set) => ({
      config: defaultSettings,
      lastValidConfig: defaultSettings,

      applyConfig: (cfg) =>
        set((s) => {
          s.config = cfg;
          s.lastValidConfig = cfg;
        }),

      revertToLastValid: () =>
        set((s) => {
          s.config = s.lastValidConfig;
        }),

      reset: () =>
        set((s) => {
          s.config = defaultSettings;
          s.lastValidConfig = defaultSettings;
        }),
    })),
    { name: "settingsStore" }
  )
);
