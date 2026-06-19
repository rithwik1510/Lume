// src/store/sessionDragStore.ts
//
// Transient state for the "drag a session row onto the main area to split the
// screen" gesture. The drag itself is driven imperatively by
// lib/internalSessionDrag (a pointer drag, not HTML5 DnD — see that file for
// why); this store only exposes what MainArea needs to render the drop
// affordance (the right-half highlight). Never persisted.

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { SessionId } from "@/store/sessionsStore";

interface SessionDragState {
  /** The session currently being dragged, or null when no drag is active. */
  draggingId: SessionId | null;
  /** Whether the pointer is currently over the main area (a valid drop). */
  over: boolean;
  setDragging: (id: SessionId | null) => void;
  setOver: (over: boolean) => void;
  clear: () => void;
}

export const useSessionDragStore = create<SessionDragState>()(
  devtools(
    (set) => ({
      draggingId: null,
      over: false,
      setDragging: (id) => set({ draggingId: id }),
      setOver: (over) => set({ over }),
      clear: () => set({ draggingId: null, over: false }),
    }),
    { name: "sessionDragStore" }
  )
);
