// src/store/mdStore.ts
import { create } from "zustand";
import { devtools, persist, createJSONStorage } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

import { readTextFile, writeTextFile } from "@/lib/fsClient";
import { tauriPersistStorage } from "@/lib/persistStorage";
import { useToastStore } from "@/store/toastStore";

export interface MdTab {
  id: string;
  path: string;
  content: string;
  dirty: boolean;
}

export interface QuickViewerState {
  open: boolean;
  path: string | null;
  content: string;
}

export type MdEditorMode = "off" | "full";

export type FocusedSurface =
  | "terminal"
  | "md-editor"
  | "quick-viewer"
  | "sidebar"
  | null;

export interface MdStoreState {
  mdEditorMode: MdEditorMode;
  tabs: MdTab[];
  activeTabId: string | null;
  quickViewer: QuickViewerState;
  focusedSurface: FocusedSurface;

  // Quick Viewer — read-only rendered HTML. Editing happens in MD Editor
  // Full View (openMdTab) to keep a single editing surface across the app.
  openMdInQuickViewer: (path: string) => Promise<void>;
  closeQuickViewer: () => void;

  // MD Editor Full View (used in Phase 6)
  setMdEditorMode: (mode: MdEditorMode) => void;
  openMdTab: (path: string) => Promise<void>;
  setActiveTab: (id: string) => void;
  setTabContent: (id: string, content: string) => void;
  saveMdTab: (id: string) => Promise<void>;
  closeMdTab: (id: string) => void;

  setFocusedSurface: (s: FocusedSurface) => void;

  reset: () => void;
}

let _tabSeq = 0;
const nextTabId = () => `mdtab-${++_tabSeq}`;
let _qvReq = 0;

export const useMdStore = create<MdStoreState>()(
  devtools(
    persist(
      immer((set, get) => ({
      mdEditorMode: "off",
      tabs: [],
      activeTabId: null,
      quickViewer: { open: false, path: null, content: "" },
      focusedSurface: null,

      openMdInQuickViewer: async (path) => {
        const req = ++_qvReq;
        const content = await readTextFile(path);
        if (req !== _qvReq) return; // a newer open superseded this read
        set((s) => {
          s.quickViewer = { open: true, path, content };
        });
      },
      closeQuickViewer: () => {
        set((s) => {
          s.quickViewer = { open: false, path: null, content: "" };
        });
      },

      setMdEditorMode: (mode) =>
        set((s) => {
          s.mdEditorMode = mode;
        }),
      openMdTab: async (path) => {
        const existing = get().tabs.find((t) => t.path === path);
        if (existing) {
          set((s) => {
            s.activeTabId = existing.id;
            s.mdEditorMode = "full";
          });
          return;
        }
        const content = await readTextFile(path);
        // Re-check after the await — a concurrent open of the same path may
        // have already created the tab while we were reading.
        const already = get().tabs.find((t) => t.path === path);
        if (already) {
          set((s) => {
            s.activeTabId = already.id;
            s.mdEditorMode = "full";
          });
          return;
        }
        const id = nextTabId();
        set((s) => {
          s.tabs.push({ id, path, content, dirty: false });
          s.activeTabId = id;
          s.mdEditorMode = "full";
        });
      },
      setActiveTab: (id) =>
        set((s) => {
          s.activeTabId = id;
        }),
      setTabContent: (id, content) =>
        set((s) => {
          const t = s.tabs.find((t) => t.id === id);
          if (t) {
            t.content = content;
            t.dirty = true;
          }
        }),
      saveMdTab: async (id) => {
        const t = get().tabs.find((t) => t.id === id);
        if (!t) return;
        const written = t.content; // snapshot exactly what we write to disk
        try {
          await writeTextFile(t.path, written);
          set((s) => {
            const tt = s.tabs.find((t) => t.id === id);
            // Only clear dirty if the content hasn't changed since this write
            // started; otherwise the user typed during the save and edits remain
            // unsaved.
            if (tt && tt.content === written) tt.dirty = false;
          });
          useToastStore.getState().push({
            severity: "success",
            message: `Saved ${t.path.split(/[/\\]/).pop() ?? t.path}`,
          });
        } catch (err) {
          // Toast is the user-facing surface; no rethrow because the only
          // caller (useKeyboardShortcuts.saveActiveMdTab) calls this via
          // `void` and doesn't await — a rethrow becomes an unhandled
          // promise rejection that just adds console noise on top of the
          // already-visible error toast.
          useToastStore.getState().push({
            severity: "error",
            message: `Save failed: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
      },
      closeMdTab: (id) => {
        const closing = get().tabs.find((t) => t.id === id);
        set((s) => {
          const idx = s.tabs.findIndex((t) => t.id === id);
          if (idx === -1) return;
          s.tabs.splice(idx, 1);
          if (s.activeTabId === id) {
            s.activeTabId =
              s.tabs.length === 0 ? null : s.tabs[Math.min(idx, s.tabs.length - 1)].id;
          }
          if (s.tabs.length === 0) s.mdEditorMode = "off";
        });
        if (closing?.dirty) {
          useToastStore.getState().push({
            severity: "warn",
            message: `Closed ${closing.path.split(/[/\\]/).pop() ?? closing.path} with unsaved changes`,
          });
        }
      },

      setFocusedSurface: (focusedSurface) =>
        set((s) => {
          s.focusedSurface = focusedSurface;
        }),

      reset: () =>
        set((s) => {
          s.mdEditorMode = "off";
          s.tabs = [];
          s.activeTabId = null;
          s.quickViewer = { open: false, path: null, content: "" };
          s.focusedSurface = null;
        }),
    })),
      {
        name: "md",
        storage: createJSONStorage(() => tauriPersistStorage("lume-store.json")),
        version: 1,
        // tabs / quickViewer / focusedSurface are ephemeral session state.
        // Only mdEditorMode survives restart (DESIGN.md §4 EXCLUDED list).
        partialize: (state) => ({ mdEditorMode: state.mdEditorMode }),
      }
    ),
    { name: "mdStore" }
  )
);
