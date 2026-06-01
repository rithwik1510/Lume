// SessionRow — one session inside a SessionGroup. Spec §6.3.

import { useState, type MouseEvent as ReactMouseEvent } from "react";
import styles from "@/components/SessionRow.module.css";
import { useSessionsStore, type Session } from "@/store/sessionsStore";
import { useConfirmStore } from "@/store/confirmStore";
import { useContextMenuStore } from "@/store/contextMenuStore";
import { revealInExplorer } from "@/lib/revealInExplorer";
import { InlineRename } from "@/components/InlineRename";
import { IconTrash } from "@/components/icons";

interface Props {
  session: Session;
}

export function SessionRow({ session }: Props) {
  const activeId = useSessionsStore((s) => s.activeSessionId);
  const activate = useSessionsStore((s) => s.activateSession);
  const purge = useSessionsStore((s) => s.purgeSession);
  const rename = useSessionsStore((s) => s.renameSession);
  const isActive = session.id === activeId;
  const [renaming, setRenaming] = useState(false);

  const dotClass = isActive
    ? styles.dotActive
    : session.unread
    ? styles.dotUnread
    : styles.dotStopped;

  const onClick = () => {
    if (renaming) return;
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

  const onDoubleClick = (e: ReactMouseEvent<HTMLSpanElement>) => {
    e.stopPropagation();
    setRenaming(true);
  };

  const onContextMenu = (e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    useContextMenuStore.getState().openMenu(e.clientX, e.clientY, [
      { label: "Rename", onClick: () => setRenaming(true) },
      { label: "Reveal in Explorer", onClick: () => void revealInExplorer(session.folderPath) },
      {
        label: "Delete",
        onClick: async () => {
          const ok = await useConfirmStore.getState().confirm({
            title: "Delete session?",
            message: `Delete session "${session.name}"? This cannot be undone.`,
            confirmLabel: "Delete",
            danger: true,
          });
          if (ok) purge(session.id);
        },
      },
    ]);
  };

  return (
    <div
      className={`${styles.row} ${isActive ? styles.active : ""}`}
      data-session-id={session.id}
      title={session.name}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      <span className={`${styles.dot} ${dotClass}`} aria-hidden="true" />
      {renaming ? (
        <InlineRename
          initial={session.name}
          onCommit={(value) => {
            rename(session.id, value);
            setRenaming(false);
          }}
          onCancel={() => setRenaming(false)}
        />
      ) : (
        <span className={styles.name} onDoubleClick={onDoubleClick}>
          {session.name}
        </span>
      )}
      <button
        className={styles.trash}
        onClick={(e) => void onTrash(e)}
        title="Delete session"
        aria-label="Delete session"
      >
        <IconTrash size={14} />
      </button>
    </div>
  );
}
