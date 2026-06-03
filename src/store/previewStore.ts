// src/store/previewStore.ts
//
// Localhost preview panel state. A sibling to the MD Quick Viewer (mdStore's
// quickViewer slice). `url` survives close so re-opening returns to the last
// address. `reloadNonce` is bumped to force the <iframe> to remount. Transient
// — not persisted in v1.

import { create } from "zustand";
import { devtools } from "zustand/middleware";

interface PreviewState {
  open: boolean;
  url: string;
  reloadNonce: number;
}
interface PreviewActions {
  openPreview: (url?: string) => void;
  closePreview: () => void;
  setUrl: (url: string) => void;
  reload: () => void;
  reset: () => void;
}
export type PreviewStore = PreviewState & PreviewActions;

const initial: PreviewState = { open: false, url: "", reloadNonce: 0 };

export const usePreviewStore = create<PreviewStore>()(
  devtools(
    (set) => ({
      ...initial,
      openPreview: (url) =>
        set((s) => ({ open: true, url: url ?? s.url })),
      closePreview: () => set({ open: false }),
      setUrl: (url) => set({ url }),
      reload: () => set((s) => ({ reloadNonce: s.reloadNonce + 1 })),
      reset: () => set({ ...initial }),
    }),
    { name: "previewStore" }
  )
);
