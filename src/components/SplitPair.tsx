// SplitPair — two SessionRows rendered as one durable split group, joined by a
// bracket in the left gutter (the "[ " that embraces both rows). The pairing is
// stored in sessionsStore.splitGroups; planSidebar() folds a group into a single
// "pair" row anchored at the left member's slot. Clicking either row re-opens
// the split (SessionRow → enterSession); right-click → Ungroup. The bracket
// glows accent while this pair is the split currently on screen.

import styles from "@/components/SplitPair.module.css";
import { SessionRow } from "@/components/SessionRow";
import { useSessionsStore, type Session } from "@/store/sessionsStore";

interface Props {
  left: Session;
  right: Session;
}

export function SplitPair({ left, right }: Props) {
  const splitView = useSessionsStore((s) => s.splitView);
  const shown =
    splitView !== null && splitView.includes(left.id) && splitView.includes(right.id);

  return (
    <div
      className={`${styles.pair} ${shown ? styles.pairActive : ""}`}
      data-split-pair=""
      title="Split group — click either to open side-by-side"
    >
      <SessionRow session={left} />
      <SessionRow session={right} />
    </div>
  );
}
