// src/store/previewStore.ts
//
// Localhost preview panel state. A sibling to the MD Quick Viewer (mdStore's
// quickViewer slice). `url` survives close so re-opening returns to the last
// address, and defaults to the most common dev-server port so the panel shows
// something useful the moment it's opened. `reloadNonce` is bumped to force the
// <iframe> to remount. Transient — not persisted in v1.

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { normalizePreviewUrl } from "@/lib/normalizePreviewUrl";

/** The port most local dev servers use — opened to by default so the user
 *  doesn't have to type a URL for the common case. */
const DEFAULT_PREVIEW_URL = "http://localhost:3000";

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

const initial: PreviewState = { open: false, url: DEFAULT_PREVIEW_URL, reloadNonce: 0 };

export const usePreviewStore = create<PreviewStore>()(
  devtools(
    (set) => ({
      ...initial,
      openPreview: (url) => {
        const n = url ? normalizePreviewUrl(url) : null;
        set((s) => ({ open: true, url: n ?? s.url }));
      },
      closePreview: () => set({ open: false }),
      setUrl: (url) => {
        const n = normalizePreviewUrl(url);
        if (n) set({ url: n });
      },
      reload: () => set((s) => ({ reloadNonce: s.reloadNonce + 1 })),
      reset: () => set({ ...initial }),
    }),
    { name: "previewStore" }
  )
);
