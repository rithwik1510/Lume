// src/components/StatusBar.tsx
//
// DESIGN.md §3 + CONTEXT.md "Status Bar".
// LEFT segment: focus-aware summary.
//   - Terminal focused  -> "[shell] · [cwd]"
//   - MD Editor focused -> "[file] · Ln N, Col M"
//   - Quick Viewer      -> same as MD Editor (file name only — no cursor)
//   - Sidebar focused   -> workspace folder path
// RIGHT segment: "[workspace short name]  ⏵ N" — N counts running PTYs.
//
// v0.1 limitation: "running" means "PTY is alive", not "shell is in a
// foreground program". OSC 7 shell-integration (v0.2) refines this.

import styles from "@/components/StatusBar.module.css";
import { useMdStore } from "@/store/mdStore";
import { useLayoutStore } from "@/store/layoutStore";
import { usePtyStore } from "@/store/ptyStore";
import { useSidebarStore } from "@/store/sidebarStore";
import { shellLabel } from "@/lib/shellsClient";

function shortName(path: string | null): string {
  if (!path) return "—";
  // Pick the trailing path segment; trim trailing slashes first.
  const trimmed = path.replace(/[/\\]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

export function StatusBar() {
  const focusedSurface = useMdStore((s) => s.focusedSurface);
  const focusedPaneId = useLayoutStore((s) => s.focusedPaneId);
  const panes = usePtyStore((s) => s.panes);
  const tabs = useMdStore((s) => s.tabs);
  const activeTabId = useMdStore((s) => s.activeTabId);
  const qvPath = useMdStore((s) => s.quickViewer.path);
  const workspaceFolder = useSidebarStore((s) => s.workspaceFolder);

  // ---- LEFT segment ----
  let left = "";
  if (focusedSurface === "md-editor") {
    const tab = tabs.find((t) => t.id === activeTabId);
    if (tab) {
      const name = shortName(tab.path);
      // Ln/Col is not tracked in v0.1 (no CM-EditorView selector lift into
      // the store). Display the file name with a (-, -) placeholder so the
      // shape matches the spec; v0.2 wires selection state.
      left = `${name} · Ln —, Col —`;
    } else {
      left = "MD Editor";
    }
  } else if (focusedSurface === "quick-viewer") {
    left = qvPath ? shortName(qvPath) : "Quick Viewer";
  } else if (focusedSurface === "sidebar") {
    left = workspaceFolder ?? "";
  } else if (focusedSurface === "terminal" && focusedPaneId !== null) {
    const meta = panes[focusedPaneId];
    if (meta) {
      const shell = shellLabel(meta.shell);
      const cwd = meta.cwd ?? "(unknown cwd)";
      left = `${shell} · ${cwd}`;
    } else {
      left = "Terminal";
    }
  } else {
    // No focused surface yet (e.g. first launch before anything has focus).
    left = workspaceFolder ?? "";
  }

  // ---- RIGHT segment ----
  // Count panes whose status is "running". This is a v0.1 approximation —
  // see file-header note.
  const runningCount = Object.values(panes).filter(
    (p) => p.status === "running"
  ).length;
  const wsShort = shortName(workspaceFolder);

  return (
    <div className={styles.root} aria-label="Status Bar">
      <div className={styles.left} title={left}>
        {left}
      </div>
      <div className={styles.right}>
        <span className={styles.workspace}>{wsShort}</span>
        {runningCount > 0 && (
          <>
            <span className={styles.sep}>·</span>
            <span
              className={styles.proc}
              title={`${runningCount} terminal${runningCount === 1 ? "" : "s"} running`}
              aria-label={`${runningCount} running terminals`}
            >
              {`⏵ ${runningCount}`}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
