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

  // Two signals (see attentionTracker.ts), needs-you trumping in-progress —
  // and BOTH only for background sessions. The session you're viewing never
  // signals: you can see the terminal itself, so a spinner/dot there is
  // noise. (The store still tracks `working` for the active session — that's
  // a fact; hiding it here is a presentation choice.)
  //   unread  → accent dot ("finished / needs you")
  //   working → tumbling logo square ("agent/command actively running")
  // Otherwise: neutral filled dot for the session you're viewing, hollow for
  // idle ones.
  const working = !isActive && !session.unread && session.working;
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
      {/* Fixed-size slot so every state (circle dots, working box) occupies
        * identical space — the label never shifts when the state changes and
        * the indicator stays optically centred against the session name. */}
      <span className={styles.indicator} aria-hidden="true">
        {working ? (
          /* The Lume mark, animated: logo box outline + the accent pane
           * tumbling clockwise inside it (see SessionRow.module.css). SVG so
           * the geometry is exact and crisp at any DPI scale. */
          <svg className={styles.workingMark} viewBox="0 0 13 13">
            <rect
              className={styles.workingBox}
              x="0.75"
              y="0.75"
              width="11.5"
              height="11.5"
              rx="3"
              fill="none"
              strokeWidth="1.5"
            />
            <rect className={styles.workingPane} x="2.25" y="2.25" width="4" height="4" rx="1.25" />
          </svg>
        ) : (
          <span className={`${styles.dot} ${dotClass}`} />
        )}
      </span>
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
        /* Keyed by name: a rename (manual or the legacy "New session" →
         * "Session N" migration) remounts the span, replaying the short
         * fade/slide-in so the new name visibly "arrives". */
        <span key={session.name} className={styles.name} onDoubleClick={onDoubleClick}>
          {session.name}
        </span>
      )}
      <button
        className={styles.trash}
        onClick={(e) => void onTrash(e)}
        title="Delete session"
        aria-label="Delete session"
      >
        <IconTrash size={18} />
      </button>
    </div>
  );
}
