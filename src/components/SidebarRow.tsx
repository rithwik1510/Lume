// One file-or-folder row. Visual only; container handles click logic.
import type { MouseEvent as ReactMouseEvent } from "react";

import styles from "@/components/Sidebar.module.css";

interface Props {
  name: string;
  isDir: boolean;
  depth: number;
  expanded: boolean;
  selected: boolean;
  dimmed: boolean;
  onClick: () => void;
  onContextMenu?: (e: ReactMouseEvent<HTMLDivElement>) => void;
}

export function SidebarRow({
  name,
  isDir,
  depth,
  expanded,
  selected,
  dimmed,
  onClick,
  onContextMenu,
}: Props) {
  const indent = depth * 12;
  const chevron = isDir ? (expanded ? "▾" : "▸") : "";
  const icon = isDir ? "▢" : name.endsWith(".md") ? "✎" : "·";
  const rowClass = [
    styles.row,
    selected ? styles.selected : "",
    dimmed ? styles.dim : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div
      className={rowClass}
      style={{ paddingLeft: indent }}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      <span className={isDir ? styles.chevron : `${styles.chevron} ${styles.placeholder}`}>{chevron}</span>
      <span className={styles.icon}>{icon}</span>
      <span className={styles.label}>{name}</span>
    </div>
  );
}
