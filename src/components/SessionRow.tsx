// SessionRow — one session inside a SessionGroup. Spec §6.3.

import type { MouseEvent as ReactMouseEvent } from "react";
import styles from "@/components/SessionRow.module.css";
import { useSessionsStore, type Session } from "@/store/sessionsStore";
import { useConfirmStore } from "@/store/confirmStore";

interface Props {
  session: Session;
}

export function SessionRow({ session }: Props) {
  const activeId = useSessionsStore((s) => s.activeSessionId);
  const activate = useSessionsStore((s) => s.activateSession);
  const purge = useSessionsStore((s) => s.purgeSession);
  const isActive = session.id === activeId;

  const dotClass = isActive
    ? styles.dotActive
    : session.unread
    ? styles.dotUnread
    : styles.dotStopped;

  const onClick = () => {
    activate(session.id);
  };

  const onTrash = async (e: ReactMouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const ok = await useConfirmStore.getState().confirm({
      title: "Delete session?",
      message: `Delete session "${session.name}"? This cannot be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (ok) purge(session.id);
  };

  return (
    <div
      className={`${styles.row} ${isActive ? styles.active : ""}`}
      data-session-id={session.id}
      title={session.name}
      onClick={onClick}
    >
      <span className={`${styles.dot} ${dotClass}`} aria-hidden="true" />
      <span className={styles.name}>{session.name}</span>
      <button
        className={styles.trash}
        onClick={(e) => void onTrash(e)}
        title="Delete session"
        aria-label="Delete session"
      >
        ×
      </button>
    </div>
  );
}
