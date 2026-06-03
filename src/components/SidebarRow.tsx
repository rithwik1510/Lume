// One file-or-folder row. Visual only; container handles click logic.
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from "react";

import styles from "@/components/Sidebar.module.css";
import {
  IconChevron,
  IconFile,
  IconFileText,
  IconFolder,
} from "@/components/icons";

interface Props {
  name: string;
  isDir: boolean;
  depth: number;
  expanded: boolean;
  selected: boolean;
  dimmed: boolean;
  onClick: () => void;
  onContextMenu?: (e: ReactMouseEvent<HTMLDivElement>) => void;
  onMouseDown?: (e: ReactMouseEvent<HTMLDivElement>) => void;
  draggable?: boolean;
  onDragStart?: (e: ReactDragEvent<HTMLDivElement>) => void;
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
  onMouseDown,
  draggable,
  onDragStart,
}: Props) {
  const indent = depth * 12;
  const rowClass = [
    styles.row,
    selected ? styles.selected : "",
    dimmed ? styles.dim : "",
  ]
    .filter(Boolean)
    .join(" ");
  // Chevron: only directories get a real one; files render an invisible
  // placeholder so labels still align. Folders rotate -90deg when collapsed.
  const chevronClass = isDir
    ? `${styles.chevron} ${expanded ? "" : styles.chevronCollapsed}`
    : `${styles.chevron} ${styles.placeholder}`;
  // Leaf icon: folder, .md (text-bearing doc), or generic file.
  const LeafIcon = isDir
    ? IconFolder
    : name.endsWith(".md")
    ? IconFileText
    : IconFile;
  return (
    <div
      className={rowClass}
      style={{ paddingLeft: indent }}
      onClick={onClick}
      onContextMenu={onContextMenu}
      onMouseDown={onMouseDown}
      draggable={draggable}
      onDragStart={onDragStart}
    >
      <span className={chevronClass} aria-hidden="true">
        <IconChevron size={12} />
      </span>
      <span className={styles.icon} aria-hidden="true">
        <LeafIcon size={13} />
      </span>
      <span className={styles.label}>{name}</span>
    </div>
  );
}
