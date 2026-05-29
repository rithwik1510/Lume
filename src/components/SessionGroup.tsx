// SessionGroup — header + nested session rows. See spec §6.2.
//
// Phase 3a: read-only render. Caret click + per-group `+` + context menu are
// wired in Phase 3b/3c.

import styles from "@/components/SessionGroup.module.css";
import { SessionRow } from "@/components/SessionRow";
import type { SessionGroupView } from "@/store/sessionsStore";

interface Props {
  group: SessionGroupView;
}

export function SessionGroup({ group }: Props) {
  return (
    <div className={styles.group} data-folder={group.folderPath}>
      <div className={styles.header} title={group.folderPath}>
        <span className={`${styles.caret} ${group.collapsed ? styles.caretCollapsed : ""}`}>
          ▾
        </span>
        <span className={styles.label}>{group.label}</span>
        <button className={styles.add} title={`+ session in ${group.label}`} aria-label="Add session to group">
          +
        </button>
      </div>
      {!group.collapsed && (
        <div className={styles.children}>
          {group.sessions.map((s) => (
            <SessionRow key={s.id} session={s} />
          ))}
        </div>
      )}
    </div>
  );
}
