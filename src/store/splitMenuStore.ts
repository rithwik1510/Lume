// src/store/splitMenuStore.ts
//
// Minimal store for the ⊞ split menu popup in the TopBar. Holds only
// the open flag plus the screen-space anchor coordinates the popover
// renders at (TopBar reads getBoundingClientRect on the ⊞ button and
// pushes the bottom-left corner into show()).

import { create } from "zustand";

interface SplitMenuState {
  open: boolean;
  anchorX: number;
  anchorY: number;
}

interface SplitMenuActions {
  show: (x: number, y: number) => void;
  close: () => void;
}

export type SplitMenuStore = SplitMenuState & SplitMenuActions;

export const useSplitMenuStore = create<SplitMenuStore>((set) => ({
  open: false,
  anchorX: 0,
  anchorY: 0,
  show: (x, y) => set({ open: true, anchorX: x, anchorY: y }),
  close: () => set({ open: false }),
}));
