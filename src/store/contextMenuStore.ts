// contextMenuStore — single floating context menu state. Right-click anywhere
// in the app opens THIS menu (one instance, mounted once in App.tsx). Items
// can have a submenu or an onClick. Per DESIGN.md §4: devtools middleware,
// atomic selectors. Plain `set` (no immer) — state is shallow.

import { create } from "zustand";
import { devtools } from "zustand/middleware";

export interface ContextMenuItem {
  label: string;
  /** Optional submenu — if set, hovering opens it. */
  submenu?: ContextMenuItem[];
  /** Optional click handler (ignored if submenu is set). */
  onClick?: () => void;
  /** Set to true to render as a separator (label is ignored). */
  separator?: boolean;
}

export interface ContextMenuState {
  open: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
  openMenu: (x: number, y: number, items: ContextMenuItem[]) => void;
  close: () => void;
}

export const useContextMenuStore = create<ContextMenuState>()(
  devtools(
    (set) => ({
      open: false,
      x: 0,
      y: 0,
      items: [],
      openMenu: (x, y, items) => set({ open: true, x, y, items }),
      close: () => set({ open: false, items: [] }),
    }),
    { name: "contextMenuStore" }
  )
);
