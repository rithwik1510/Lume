// ptyStore — per-pane metadata. Critical invariant per DESIGN.md §4 rule #1:
//   PTY *bytes* NEVER touch this store. They flow Rust → Channel → xterm.write.
//
// What lives here:
//   - shell, cwd, status, lastActivity, errorReason — small, cheap, throttled.
//
// `lastActivity` updates are throttled to 200ms per pane (rule #4).

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

import type { PaneId, PaneMetadata, PaneStatus, Shell } from "@/types";
import { createThrottle } from "./throttle";

const activityThrottle = createThrottle(200);

interface PtyStoreState {
  panes: Record<PaneId, PaneMetadata>;
}

interface PtyStoreActions {
  /** Create the metadata record for a freshly-spawned pane. */
  addPane: (paneId: PaneId, shell: Shell) => void;
  removePane: (paneId: PaneId) => void;
  setStatus: (
    paneId: PaneId,
    status: PaneStatus,
    errorReason?: string | null
  ) => void;
  setCwd: (paneId: PaneId, cwd: string | null) => void;
  /** Called from the per-pane PTY data handler. Throttled: at most 5x/sec/pane. */
  markActivity: (paneId: PaneId, now?: number) => void;
  /** Test/utility hook to clear the throttle without nuking the store. */
  _resetActivityThrottle: (paneId?: PaneId) => void;
}

export type PtyStore = PtyStoreState & PtyStoreActions;

export const usePtyStore = create<PtyStore>()(
  devtools(
    immer((set) => ({
      panes: {},

      addPane: (paneId, shell) =>
        set(
          (d) => {
            d.panes[paneId] = {
              paneId,
              shell,
              cwd: null,
              status: "spawning",
              lastActivity: Date.now(),
              errorReason: null,
            };
          },
          false,
          "pty/addPane"
        ),

      removePane: (paneId) =>
        set(
          (d) => {
            delete d.panes[paneId];
          },
          false,
          "pty/removePane"
        ),

      setStatus: (paneId, status, errorReason = null) =>
        set(
          (d) => {
            const p = d.panes[paneId];
            if (!p) return;
            p.status = status;
            p.errorReason = errorReason;
          },
          false,
          "pty/setStatus"
        ),

      setCwd: (paneId, cwd) =>
        set(
          (d) => {
            const p = d.panes[paneId];
            if (!p) return;
            p.cwd = cwd;
          },
          false,
          "pty/setCwd"
        ),

      markActivity: (paneId, now = Date.now()) => {
        if (!activityThrottle.shouldEmit(paneId, now)) return;
        set(
          (d) => {
            const p = d.panes[paneId];
            if (!p) return;
            p.lastActivity = now;
          },
          false,
          "pty/markActivity"
        );
      },

      _resetActivityThrottle: (paneId) => activityThrottle.reset(paneId),
    })),
    { name: "pty", enabled: import.meta.env.DEV }
  )
);
