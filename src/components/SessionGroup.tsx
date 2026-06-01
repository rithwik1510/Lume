// SessionGroup — header + nested session rows. See spec §6.2.
//
// Phase 3b: caret toggles collapsed state; `+` creates a session in this folder.
// Phase 3c.3: double-click label to rename group (empty commit reverts to basename).

import { useState, type MouseEvent as ReactMouseEvent } from "react";
import styles from "@/components/SessionGroup.module.css";
import { SessionRow } from "@/components/SessionRow";
import { useSessionsStore, type SessionGroupView } from "@/store/sessionsStore";
import { createAndActivateSession } from "@/lib/sessions/sessionEntryFlows";
import { InlineRename } from "@/components/InlineRename";
import { IconChevron, IconPlus } from "@/components/icons";
import { useContextMenuStore } from "@/store/contextMenuStore";
import { useConfirmStore } from "@/store/confirmStore";
import { revealInExplorer } from "@/lib/revealInExplorer";

interface Props {
  group: SessionGroupView;
}

export function SessionGroup({ group }: Props) {
  const toggle = useSessionsStore((s) => s.toggleGroupCollapsed);
  const setLabel = useSessionsStore((s) => s.setGroupLabel);
  const purgeGroup = useSessionsStore((s) => s.purgeGroup);
  const [renaming, setRenaming] = useState(false);

  const onHeaderClick = () => {
    if (renaming) return;
    toggle(group.folderPath);
  };

  const onAddClick = (e: ReactMouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    createAndActivateSession(group.folderPath);
  };

  const onLabelDoubleClick = (e: ReactMouseEvent<HTMLSpanElement>) => {
    e.stopPropagation();
    setRenaming(true);
  };

  const onContextMenu = (e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    useContextMenuStore.getState().openMenu(e.clientX, e.clientY, [
      { label: "Rename group", onClick: () => setRenaming(true) },
      { label: "Reveal in Explorer", onClick: () => void revealInExplorer(group.folderPath) },
      { label: group.collapsed ? "Expand" : "Collapse", onClick: () => toggle(group.folderPath) },
      {
        label: "Delete group",
        onClick: async () => {
          const ok = await useConfirmStore.getState().confirm({
            title: "Delete group?",
            message: `Delete group "${group.label}" and all ${group.sessions.length} session(s)? This cannot be undone.`,
            confirmLabel: "Delete all",
            danger: true,
          });
          if (ok) purgeGroup(group.folderPath);
        },
      },
    ]);
  };

  return (
    <div className={styles.group} data-folder={group.folderPath}>
      <div className={styles.header} onClick={onHeaderClick} onContextMenu={onContextMenu} title={group.folderPath}>
        <span className={`${styles.caret} ${group.collapsed ? styles.caretCollapsed : ""}`}>
          <IconChevron size={12} />
        </span>
        {renaming ? (
          <InlineRename
            initial={group.label}
            onCommit={(value) => {
              setLabel(group.folderPath, value);
              setRenaming(false);
            }}
            onCancel={() => setRenaming(false)}
          />
        ) : (
          <span className={styles.label} onDoubleClick={onLabelDoubleClick}>
            {group.label}
          </span>
        )}
        <button
          className={styles.add}
          onClick={onAddClick}
          title="Add session to this project"
          aria-label="Add session to group"
        >
          <IconPlus size={14} />
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
