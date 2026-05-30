// SessionsSidebar — grouped tree of sessions per folder. See spec §6.
//
// This sub-phase (3a) is read-only — no click/contextmenu/rename handlers yet.
// 3b adds interactions, 3c adds rename and context menus.

import styles from "@/components/SessionsSidebar.module.css";
import { SessionGroup } from "@/components/SessionGroup";
import { pickAndCreateSession } from "@/lib/sessions/sessionEntryFlows";
import { groupedSessions, useSessionsStore } from "@/store/sessionsStore";

export function SessionsSidebar() {
  // Re-derive on every sessionsStore change. The selector is cheap (O(N) over
  // sessions); N is small in practice (a handful, not thousands).
  const groups = useSessionsStore((s) => groupedSessions(s));

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
