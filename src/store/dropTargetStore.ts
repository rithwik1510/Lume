// src/store/dropTargetStore.ts
//
// Which pane is currently the drag-and-drop target. Shared so the internal
// DOM drag (sidebar row → pane) and the external Tauri OS drop both highlight
// the same pane through one render path. Transient UI state — never persisted.

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { PaneId } from "@/types";

interface DropTargetState {
  paneId: PaneId | null;
  setDropTarget: (id: PaneId | null) => void;
}

export const useDropTargetStore = create<DropTargetState>()(
  devtools(
    (set) => ({
      paneId: null,
      setDropTarget: (id) => set({ paneId: id }),
    }),
    { name: "dropTargetStore" }
  )
);
