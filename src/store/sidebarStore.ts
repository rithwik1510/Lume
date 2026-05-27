// sidebarStore — Workspace Folder, lazy-loaded file tree entries, expand
// state, and filter text. See DESIGN.md §3 (Sidebar surface) and §4 (data-flow
// rules: immer + devtools, atomic selectors).

import { create } from "zustand";
import { devtools, persist, createJSONStorage } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";
import { enableMapSet } from "immer";
import type { DirEntry } from "@/types/fs";
import { tauriPersistStorage } from "@/lib/persistStorage";

// Immer doesn't proxy Map/Set drafts unless the MapSet plugin is loaded. This
// store keeps `entries: Map` and `expanded: Set`, so we enable it once at
// module load. Calling enableMapSet more than once is a no-op.
enableMapSet();

/** Folder names rendered collapsed-by-default (DESIGN.md §3). */
export const COLLAPSED_DIRS: ReadonlySet<string> = new Set([
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
]);

export interface SidebarState {
  workspaceFolder: string | null;
  /** path → its direct children (already loaded). */
  entries: Map<string, DirEntry[]>;
  /** Set of expanded folder paths. */
  expanded: Set<string>;
  filterText: string;
  sidebarVisible: boolean;

  // actions
  setWorkspaceFolder: (path: string) => void;
  storeEntries: (path: string, entries: DirEntry[]) => void;
  toggleExpanded: (path: string) => void;
  setFilter: (text: string) => void;
  matchesFilter: (name: string) => boolean;
  toggleSidebar: () => void;
  setSidebarVisible: (visible: boolean) => void;
  reset: () => void;
}

export const useSidebarStore = create<SidebarState>()(
  devtools(
    persist(
      immer((set, get) => ({
      workspaceFolder: null,
      entries: new Map(),
      expanded: new Set(),
      filterText: "",
      sidebarVisible: true,

      setWorkspaceFolder: (path) =>
        set((s) => {
          // Switching workspace folders must also reset tree state — the
          // `entries` Map and `expanded` Set are keyed by absolute path,
          // so leaving them would render a stale mix of old + new folder
          // contents until the file watcher's initial Rescan catches up.
          s.workspaceFolder = path;
          s.entries = new Map();
          s.expanded = new Set();
        }),

      storeEntries: (path, entries) =>
        set((s) => {
          s.entries.set(path, entries);
        }),

      toggleExpanded: (path) =>
        set((s) => {
          if (s.expanded.has(path)) s.expanded.delete(path);
          else s.expanded.add(path);
        }),

      setFilter: (text) =>
        set((s) => {
          s.filterText = text.toLowerCase();
        }),

      matchesFilter: (name) => {
        const f = get().filterText;
        return f === "" || name.toLowerCase().includes(f);
      },

      toggleSidebar: () =>
        set((s) => {
          s.sidebarVisible = !s.sidebarVisible;
        }),

      setSidebarVisible: (visible) =>
        set((s) => {
          s.sidebarVisible = visible;
        }),

      reset: () =>
        set((s) => {
          s.workspaceFolder = null;
          s.entries = new Map();
          s.expanded = new Set();
          s.filterText = "";
          s.sidebarVisible = true;
        }),
    })),
      {
        name: "sidebar",
        storage: createJSONStorage(() => tauriPersistStorage("workstation-store.json")),
        version: 1,
        // Persist only the durable bits. entries (Map) and expanded (Set)
        // are session state — they get re-read from disk on launch via
        // listDir, so persisting would just waste space.
        partialize: (state) => ({
          workspaceFolder: state.workspaceFolder,
          sidebarVisible: state.sidebarVisible,
        }),
      }
    ),
    { name: "sidebarStore" }
  )
);
