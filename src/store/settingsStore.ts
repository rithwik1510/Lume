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

/** Read a dotted path from a config object (undefined if any segment missing). */
function getDotted(obj: unknown, path: string): unknown {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let cur: any = obj;
  for (const seg of path.split(".")) cur = cur?.[seg];
  return cur;
}

// Self-write echo suppression. A GUI edit writes config.toml, which the file
// watcher then sees — re-reading it and replacing the whole store would clobber
// any still-in-flight optimistic edits and cause visible flicker on rapid
// multi-key changes. While we're actively writing our own changes, the store is
// the authority; the watcher skips reconcile inside this window. Each edit
// extends it past the debounce + write + watch-latency tail. External edits
// (made while NOT editing in the GUI) still hot-reload normally.
let selfWriteUntil = 0;
const SELF_WRITE_WINDOW_MS = PERSIST_DEBOUNCE_MS + 950;
function markSelfWrite(): void {
  selfWriteUntil = Math.max(selfWriteUntil, Date.now() + SELF_WRITE_WINDOW_MS);
}
/** True while a GUI-originated config write is settling — watcher should skip. */
export function isConfigSelfWrite(): boolean {
  return Date.now() < selfWriteUntil;
}

export const defaultSettings: WorkstationConfig = {
  default_shell: "pwsh",
  font: { family: "JetBrains Mono", size: 14, weight: 400, line_height: 1.2 },
  terminal: {
    scrollback_lines: 10_000,
    ipc_batch_ms: 32,
    ring_buffer_mb: 8,
    cursor_style: "block",
    cursor_blink: true,
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
  setConfigValue: (path: string, value: unknown) => void;
}

export type SettingsStore = SettingsState & SettingsActions;

export const useSettingsStore = create<SettingsStore>()(
  devtools(
    immer((set, get) => ({
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

      setConfigValue: (path, value) => {
        markSelfWrite(); // suppress the watcher echo from the write we're about to make
        // Capture only this path's prior leaf so a failed write reverts JUST
        // this key — never a whole-config snapshot, which would silently undo
        // a concurrent successful edit to a different key.
        const prevLeaf = getDotted(get().config, path);
        // structuredClone (inside setDotted) can't clone an immer draft Proxy,
        // so compute the next objects from the plain get() state, then assign.
        const nextConfig = setDotted(get().config, path, value);
        const nextValid = setDotted(get().lastValidConfig, path, value);
        set((s) => {
          s.config = nextConfig;
          s.lastValidConfig = nextValid;
        });
        const existing = persistTimers.get(path);
        if (existing) clearTimeout(existing);
        persistTimers.set(
          path,
          setTimeout(() => {
            persistTimers.delete(path);
            markSelfWrite(); // extend the window across the actual disk write
            void rustSetConfigValue(path, value).catch((err) => {
              const revertedConfig = setDotted(get().config, path, prevLeaf);
              const revertedValid = setDotted(get().lastValidConfig, path, prevLeaf);
              set((s) => {
                s.config = revertedConfig;
                s.lastValidConfig = revertedValid;
              });
              useToastStore.getState().push({
                severity: "error",
                message: `Couldn't save settings: ${err instanceof Error ? err.message : String(err)}`,
              });
            });
          }, PERSIST_DEBOUNCE_MS)
        );
      },
    })),
    { name: "settingsStore" }
  )
);
