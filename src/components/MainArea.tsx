// MainArea — multiplexes one <PaneTree> per active session. Inactive sessions
// stay mounted but display:none, so xterm Terminal instances keep their
// host-div attachment, WebGL canvases preserve state, and background PTYs
// keep writing into hidden buffers. See spec §9.

import { useSessionsStore, type Session } from "@/store/sessionsStore";
import { PaneTree } from "@/components/PaneTree";
import styles from "@/components/MainArea.module.css";

export function MainArea() {
  const sessions = useSessionsStore((s) => s.sessions);
  const activeId = useSessionsStore((s) => s.activeSessionId);

  // Only mount active sessions. Stopped sessions have no PaneTree mounted —
  // see §9.3. Order: active session first in DOM for predictable focus stacking.
  const active: Session[] = Object.values(sessions).filter((s) => s.status === "active");

  if (active.length === 0) {
    return <div className={styles.empty}>No active session — click a session in the sidebar to revive it.</div>;
  }

  return (
    <div className={styles.root}>
      {active.map((s) => (
        <div
          key={s.id}
          className={styles.sessionPane}
          style={{ display: s.id === activeId ? "block" : "none" }}
        >
          {s.layoutRoot && <PaneTree node={s.layoutRoot} path={s.id} />}
        </div>
      ))}
    </div>
  );
}
