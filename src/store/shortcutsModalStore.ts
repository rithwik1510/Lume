// src/store/shortcutsModalStore.ts
//
// Tiny store backing the ⌨ Keyboard shortcuts viewer modal. The state
// is a single boolean (open). Actions are renamed to openModal /
// closeModal to avoid colliding with the `open` field name (TS would
// reject `open` as both a state key and an action name on the same
// shape).

import { create } from "zustand";

interface ShortcutsModalState {
  open: boolean;
}

interface ShortcutsModalActions {
  openModal: () => void;
  closeModal: () => void;
  toggle: () => void;
}

export type ShortcutsModalStore = ShortcutsModalState & ShortcutsModalActions;

export const useShortcutsModalStore = create<ShortcutsModalStore>((set, get) => ({
  open: false,
  openModal: () => set({ open: true }),
  closeModal: () => set({ open: false }),
  toggle: () => set({ open: !get().open }),
}));
