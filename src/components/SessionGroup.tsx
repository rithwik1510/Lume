// SessionGroup — header + nested session rows. See spec §6.2.
//
// Phase 3b: caret toggles collapsed state; `+` creates a session in this folder.

import type { MouseEvent as ReactMouseEvent } from "react";
import styles from "@/components/SessionGroup.module.css";
import { SessionRow } from "@/components/SessionRow";
import { useSessionsStore, type SessionGroupView } from "@/store/sessionsStore";
import { createAndActivateSession } from "@/lib/sessions/sessionEntryFlows";

interface Props {
  group: SessionGroupView;
}

export function SessionGroup({ group }: Props) {
  const toggle = useSessionsStore((s) => s.toggleGroupCollapsed);

  const onHeaderClick = () => {
    toggle(group.folderPath);
  };

  const onAddClick = (e: ReactMouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    createAndActivateSession(group.folderPath);
  };

  return (
    <div className={styles.group} data-folder={group.folderPath}>
      <div className={styles.header} onClick={onHeaderClick} title={group.folderPath}>
        <span className={`${styles.caret} ${group.collapsed ? styles.caretCollapsed : ""}`}>
          ▾
        </span>
        <span className={styles.label}>{group.label}</span>
        <button
          className={styles.add}
          onClick={onAddClick}
          title="Add session to this project"
          aria-label="Add session to group"
        >
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
