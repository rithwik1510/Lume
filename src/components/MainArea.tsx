// MainArea — multiplexes one <PaneTree> per active session. Inactive sessions
// stay mounted but display:none, so xterm Terminal instances keep their
// host-div attachment, WebGL canvases preserve state, and background PTYs
// keep writing into hidden buffers. See spec §9.
//
// Split view: when sessionsStore.splitView is set, two sessions are shown
// side-by-side. Each session wrapper is absolutely positioned, so a split is
// purely a change of left/width on two existing wrappers — no DOM reparenting,
// so xterm canvases are never disturbed (the seamless part). The seam is a
// pointer-drag splitter that reuses the same resizeBus fit-gate as PaneTree's
// internal splitters, plus a × on the seam to collapse back to one session.

import {
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { useSessionsStore, type Session } from "@/store/sessionsStore";
import { useSessionDragStore } from "@/store/sessionDragStore";
import { PaneTree } from "@/components/PaneTree";
import { IconClose } from "@/components/icons";
import { beginResize, endResize } from "@/components/resizeBus";
import styles from "@/components/MainArea.module.css";

// Match PaneTree's per-pane drag limits so neither session is ever squeezed
// below a usable terminal width.
const SPLIT_MIN_PCT = 25;
const SPLIT_MAX_PCT = 75;

type SlotRole = "solo" | "left" | "right" | "hidden";

function geometryFor(role: SlotRole, leftPct: number): CSSProperties {
  switch (role) {
    case "solo":
      return { top: 0, right: 0, bottom: 0, left: 0 };
    case "left":
      return { top: 0, bottom: 0, left: 0, width: `${leftPct}%` };
    case "right":
      return { top: 0, bottom: 0, right: 0, left: `${leftPct}%` };
    default:
      return { display: "none" };
  }
}

export function MainArea() {
  const sessions = useSessionsStore((s) => s.sessions);
  const activeId = useSessionsStore((s) => s.activeSessionId);
  const splitView = useSessionsStore((s) => s.splitView);
  const closeSplit = useSessionsStore((s) => s.closeSplit);
  const activateSession = useSessionsStore((s) => s.activateSession);

  const draggingId = useSessionDragStore((s) => s.draggingId);
  const dragOver = useSessionDragStore((s) => s.over);

  // Split ratio is local, transient view state (not persisted — per the v1
  // decision). Defaults to 50/50; a user's drag is remembered for the session.
  const [leftPct, setLeftPct] = useState(50);
  const [splitDragging, setSplitDragging] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const splitDraggingRef = useRef(false);

  const onSeamDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    splitDraggingRef.current = true;
    setSplitDragging(true);
    beginResize(); // gate xterm fit() in both sessions while the seam moves
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onSeamMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!splitDraggingRef.current || !rootRef.current) return;
    const r = rootRef.current.getBoundingClientRect();
    if (r.width === 0) return;
    const pct = ((e.clientX - r.left) / r.width) * 100;
    setLeftPct(Math.min(SPLIT_MAX_PCT, Math.max(SPLIT_MIN_PCT, pct)));
  };
  const onSeamUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!splitDraggingRef.current) return;
    splitDraggingRef.current = false;
    setSplitDragging(false);
    endResize(); // fit both sessions once, now the seam has settled
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  // All active sessions stay mounted; visibility/placement is decided per id.
  const active: Session[] = Object.values(sessions).filter((s) => s.status === "active");

  if (active.length === 0) {
    return (
      <div className={styles.empty}>
        No active session — click a session in the sidebar to revive it.
      </div>
    );
  }

  const roleOf = (id: string): SlotRole => {
    if (splitView) {
      if (id === splitView[0]) return "left";
      if (id === splitView[1]) return "right";
      return "hidden";
    }
    return id === activeId ? "solo" : "hidden";
  };

  // The drop affordance only arms when the drag would actually create or change
  // a split — i.e. you're not dragging the session that's already keyboard-active.
  const dropArmed = draggingId !== null && draggingId !== activeId;

  return (
    <div className={styles.root} ref={rootRef} data-main-area="">
      {active.map((s) => {
        const role = roleOf(s.id);
        const focused = splitView !== null && role !== "hidden" && s.id === activeId;
        return (
          <div
            key={s.id}
            className={`${styles.sessionPane} ${focused ? styles.focusedSlot : ""}`}
            style={geometryFor(role, leftPct)}
            // Clicking the non-focused visible slot hands it the keyboard
            // (focus ring + shortcut target) without moving the slots. Capture
            // so it lands before xterm takes DOM focus. No-op for the active
            // and hidden slots.
            onPointerDownCapture={() => {
              if (role !== "hidden" && s.id !== activeId) activateSession(s.id);
            }}
          >
            {s.layoutRoot && <PaneTree node={s.layoutRoot} path={s.id} />}
          </div>
        );
      })}

      {splitView && (
        <>
          <div
            className={`${styles.splitter} ${splitDragging ? styles.splitterDragging : ""}`}
            style={{ left: `${leftPct}%` }}
            onPointerDown={onSeamDown}
            onPointerMove={onSeamMove}
            onPointerUp={onSeamUp}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize split"
            title="Drag to resize"
          />
          <button
            type="button"
            className={styles.closeSplit}
            style={{ left: `${leftPct}%` }}
            onClick={() => closeSplit()}
            title="Close split"
            aria-label="Close split view"
          >
            <IconClose size={12} />
          </button>
        </>
      )}

      {dropArmed && (
        <div
          className={`${styles.dropZone} ${dragOver ? styles.dropZoneOver : ""}`}
          aria-hidden="true"
        >
          <span className={styles.dropHint}>Drop to split</span>
        </div>
      )}
    </div>
  );
}
