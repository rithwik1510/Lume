// SessionsSidebar — grouped tree of sessions per folder. See spec §6.
//
// Collapse: the sidebar stays mounted and animates its width (220 → 0) on an
// emphasised ease-out (theme --dur-panel / --ease-out) driven by the existing
// sidebarStore.sidebarVisible flag (☰ button / Ctrl+B). While the width
// animates, the terminal area reflows; we gate xterm fit() through resizeBus
// for the duration so the WebGL canvas doesn't re-clear every frame (same
// flicker guard the splitter drag uses) — fit happens once, at settle.

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import styles from "@/components/SessionsSidebar.module.css";
import { SessionGroup } from "@/components/SessionGroup";
import { IconEllipsis } from "@/components/icons";
import { beginResize, endResize } from "@/components/resizeBus";
import { pickAndCreateSession } from "@/lib/sessions/sessionEntryFlows";
import { groupedSessions, useSessionsStore } from "@/store/sessionsStore";
import { useSidebarStore } from "@/store/sidebarStore";

// Slightly longer than --dur-panel (300ms) so the gate releases just after the
// width transition settles, then xterm fits once at the final size.
const COLLAPSE_SETTLE_MS = 360;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

export function SessionsSidebar() {
  // Derive groups from the three RAW slices (each a stable reference) inside a
  // useMemo — subscribing to groupedSessions(s) directly returns a fresh array
  // every call and crashes under Zustand v5 (see SessionsSidebar.test.tsx).
  const sessions = useSessionsStore((s) => s.sessions);
  const groupLabels = useSessionsStore((s) => s.groupLabels);
  const collapsedGroups = useSessionsStore((s) => s.collapsedGroups);
  const groups = useMemo(
    () => groupedSessions({ sessions, groupLabels, collapsedGroups }),
    [sessions, groupLabels, collapsedGroups]
  );

  const collapsed = !useSidebarStore((s) => s.sidebarVisible);

  // Resizable open width (persisted + clamped in the store). The shell width
  // and the right-anchored inner both track it; collapse sets the shell to 0
  // while the inner stays this wide so it slides out cleanly.
  const sidebarWidth = useSidebarStore((s) => s.sidebarWidth);
  const setSidebarWidth = useSidebarStore((s) => s.setSidebarWidth);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);

  const onResizeDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    draggingRef.current = true;
    setDragging(true);
    beginResize(); // gate xterm fit while the terminal area reflows live
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onResizeMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current || !rootRef.current) return;
    const left = rootRef.current.getBoundingClientRect().left;
    setSidebarWidth(e.clientX - left); // store clamps to [MIN, MAX]
  };
  const onResizeUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);
    endResize();
    e.currentTarget.releasePointerCapture(e.pointerId);
  };

  // Suppress per-frame xterm fits while the collapse width-animates, then fit
  // once after it settles. Skipped on first mount (no animation on launch) and
  // under reduced-motion (layout is instant; the ResizeObserver's own debounce
  // handles the single fit). beginResize/endResize are refcounted, so we keep
  // exactly one outstanding pair and reset the settle timer on rapid toggles.
  const firstRender = useRef(true);
  const resizing = useRef(false);
  const settleTimer = useRef<number | null>(null);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (prefersReducedMotion()) return;
    if (!resizing.current) {
      resizing.current = true;
      beginResize();
    }
    if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
    settleTimer.current = window.setTimeout(() => {
      settleTimer.current = null;
      resizing.current = false;
      endResize();
    }, COLLAPSE_SETTLE_MS);
  }, [collapsed]);

  // Balance any outstanding beginResize on unmount (HMR / tests).
  useEffect(
    () => () => {
      if (settleTimer.current !== null) window.clearTimeout(settleTimer.current);
      if (resizing.current) {
        resizing.current = false;
        endResize();
      }
    },
    []
  );

  return (
    <div
      ref={rootRef}
      className={`${styles.root} ${collapsed ? styles.collapsed : ""}`}
      // Width is dynamic (resizable); collapse animates it to 0. Transition is
      // disabled mid-drag so the edge tracks the cursor 1:1 instead of lagging.
      style={{ width: collapsed ? 0 : sidebarWidth, transition: dragging ? "none" : undefined }}
      aria-hidden={collapsed}
      // `inert` (string form to avoid React 18 boolean-attr warnings) keeps Tab
      // focus out of the hidden sidebar while collapsed.
      {...(collapsed ? { inert: "" } : {})}
    >
      <div className={styles.inner} style={{ width: sidebarWidth }}>
        <div className={styles.toolbar}>
          <button
            className={styles.newBtn}
            title="New session (Ctrl+Shift+T)"
            aria-label="New session"
            onClick={() => void pickAndCreateSession()}
          >
            + New session
          </button>
          <button className={styles.menuBtn} title="Filter & options" aria-label="Filter and options">
            <IconEllipsis size={16} />
          </button>
        </div>
        <div className={styles.list}>
          {groups.length === 0 ? (
            <div className={styles.empty}>
              No sessions yet.
              <br />
              + New session to begin.
            </div>
          ) : (
            groups.map((g) => <SessionGroup key={g.folderPath} group={g} />)
          )}
        </div>
      </div>
      {!collapsed && (
        <div
          className={`${styles.resizeHandle} ${dragging ? styles.dragging : ""}`}
          onPointerDown={onResizeDown}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeUp}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          title="Drag to resize"
        />
      )}
    </div>
  );
}
