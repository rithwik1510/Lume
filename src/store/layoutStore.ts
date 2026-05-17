// layoutStore — thin Zustand wrapper over the pure reducers in layout/pure.ts.
//
// Persistence (DESIGN.md §4 rule #6) is wired up in Weekend 4 alongside
// config.toml + the rest of the settings pipeline. For Weekend 1 we just
// keep the layout in memory.

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

import type { LayoutState, PaneId } from "@/types";
import {
  emptyLayout,
  addPane,
  removePane,
  focusPane,
  moveFocus,
} from "./layout/pure";

interface LayoutActions {
  addPane: (paneId: PaneId) => void;
  removePane: (paneId: PaneId) => void;
  focusPane: (paneId: PaneId) => void;
  moveFocus: (dir: "next" | "prev") => void;
  reset: () => void;
}

export type LayoutStore = LayoutState & LayoutActions;

export const useLayoutStore = create<LayoutStore>()(
  devtools(
    immer((set) => ({
      ...emptyLayout(),
      addPane: (paneId) => set((d) => addPane(d, paneId), false, "layout/addPane"),
      removePane: (paneId) =>
        set((d) => removePane(d, paneId), false, "layout/removePane"),
      focusPane: (paneId) =>
        set((d) => focusPane(d, paneId), false, "layout/focusPane"),
      moveFocus: (dir) => set((d) => moveFocus(d, dir), false, "layout/moveFocus"),
      reset: () =>
        set(
          (d) => {
            const fresh = emptyLayout();
            d.paneIds = fresh.paneIds;
            d.focusedPaneId = fresh.focusedPaneId;
          },
          false,
          "layout/reset"
        ),
    })),
    { name: "layout", enabled: import.meta.env.DEV }
  )
);
