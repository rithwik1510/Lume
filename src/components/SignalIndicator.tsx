// SignalIndicator — the one place the sidebar's signal grammar is drawn, so a
// session row and a collapsed group-header roll-up render identically (Plan 008
// locked Design). Styles live in SessionRow.module.css (shape + saturation
// rules documented there):
//   working    → tumbling logo square
//   permission → hollow accent ring + animated glow pulse (the urgent one moves)
//   your-move  → solid accent dot + static glow
//   active     → neutral filled dot (the session you're viewing)
//   idle       → hollow grey dot

import styles from "@/components/SessionRow.module.css";
import type { SidebarSignal } from "@/sessions/sessionSignal";

export function SignalIndicator({
  signal,
  title,
}: {
  signal: SidebarSignal;
  title?: string;
}) {
  return (
    <span className={styles.indicator} aria-hidden="true" title={title}>
      {signal === "working" ? (
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
        <span className={`${styles.dot} ${dotClassFor(signal)}`} />
      )}
    </span>
  );
}

function dotClassFor(signal: SidebarSignal): string {
  switch (signal) {
    case "permission":
      return styles.dotBlocked;
    case "your-move":
      return styles.dotUnread;
    case "active":
      return styles.dotActive;
    default:
      return styles.dotStopped;
  }
}
