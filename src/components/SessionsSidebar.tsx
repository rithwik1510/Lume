// SessionsSidebar — grouped tree of sessions per folder. See spec §6.
//
// This sub-phase (3a) is read-only — no click/contextmenu/rename handlers yet.
// 3b adds interactions, 3c adds rename and context menus.

import { useMemo } from "react";

import styles from "@/components/SessionsSidebar.module.css";
import { SessionGroup } from "@/components/SessionGroup";
import { pickAndCreateSession } from "@/lib/sessions/sessionEntryFlows";
import { groupedSessions, useSessionsStore } from "@/store/sessionsStore";

export function SessionsSidebar() {
  // Subscribe to the three RAW slices groupedSessions reads. Each is a stable
  // reference between renders (immer only swaps the ones that actually change),
  // so useSyncExternalStore sees a consistent snapshot. We then derive the
  // grouped array in a useMemo. Subscribing to `groupedSessions(s)` directly
  // would return a fresh array every call → Zustand v5 + useSyncExternalStore
  // throws "getSnapshot should be cached" → black-screen crash.
  const sessions = useSessionsStore((s) => s.sessions);
  const groupLabels = useSessionsStore((s) => s.groupLabels);
  const collapsedGroups = useSessionsStore((s) => s.collapsedGroups);
  const groups = useMemo(
    () => groupedSessions({ sessions, groupLabels, collapsedGroups }),
    [sessions, groupLabels, collapsedGroups]
  );

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <button
          className={styles.newBtn}
          title="New session (Ctrl+Shift+T)"
          aria-label="New session"
          onClick={() => void pickAndCreateSession()}
        >
          + New session
        </button>
        <button className={styles.menuBtn} title="Filter & options" aria-label="Filter and options">
          ⋯
        </button>
      </div>
      <div className={styles.list}>
        {groups.length === 0 ? (
          <div className={styles.empty}>
            No sessions yet.
            <br />
            + New session to begin.
          </div>
        ) : (
          groups.map((g) => <SessionGroup key={g.folderPath} group={g} />)
        )}
      </div>
    </div>
  );
}
