// SessionRow — one session inside a SessionGroup. Spec §6.3.

import styles from "@/components/SessionRow.module.css";
import { useSessionsStore, type Session } from "@/store/sessionsStore";

interface Props {
  session: Session;
}

export function SessionRow({ session }: Props) {
  const activeId = useSessionsStore((s) => s.activeSessionId);
  const isActive = session.id === activeId;

  const dotClass = isActive
    ? styles.dotActive
    : session.unread
    ? styles.dotUnread
    : styles.dotStopped;

  return (
    <div
      className={`${styles.row} ${isActive ? styles.active : ""}`}
      data-session-id={session.id}
      title={session.name}
    >
      <span className={`${styles.dot} ${dotClass}`} aria-hidden="true" />
      <span className={styles.name}>{session.name}</span>
      <button className={styles.trash} title="Delete session" aria-label="Delete session">
        ×
      </button>
    </div>
  );
}
