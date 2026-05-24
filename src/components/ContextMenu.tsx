// ContextMenu — single floating menu bound to contextMenuStore. Mounted once
// in App.tsx; every right-click in the app reuses this instance. Supports
// one level of submenu (hover to open). Dismisses on outside-click or Escape.

import { useEffect, useState } from "react";

import styles from "@/components/ContextMenu.module.css";
import { useContextMenuStore, type ContextMenuItem } from "@/store/contextMenuStore";

export function ContextMenu() {
  const open = useContextMenuStore((s) => s.open);
  const x = useContextMenuStore((s) => s.x);
  const y = useContextMenuStore((s) => s.y);
  const items = useContextMenuStore((s) => s.items);
  const close = useContextMenuStore((s) => s.close);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(`.${styles.menu}`)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onClick, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onClick, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, close]);

  if (!open) return null;
  return <MenuLevel x={x} y={y} items={items} onPick={close} />;
}

function MenuLevel({
  x,
  y,
  items,
  onPick,
}: {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onPick: () => void;
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  return (
    <div className={styles.menu} style={{ left: x, top: y }}>
      {items.map((item, idx) => {
        if (item.separator) return <div key={idx} className={styles.separator} />;
        const hasSub = !!item.submenu && item.submenu.length > 0;
        return (
          <div
            key={idx}
            className={styles.item}
            onMouseEnter={() => setHoverIdx(idx)}
            onClick={() => {
              if (!hasSub) {
                item.onClick?.();
                onPick();
              }
            }}
          >
            <span>{item.label}</span>
            {hasSub && <span className={styles.chev}>▸</span>}
            {hasSub && hoverIdx === idx && (
              <div className={styles.submenu}>
                <MenuLevel x={0} y={0} items={item.submenu ?? []} onPick={onPick} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
