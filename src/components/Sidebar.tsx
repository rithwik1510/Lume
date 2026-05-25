// Sidebar root: header (filter + new file) + tree. On first mount, sets
// the workspace folder to home dir if it isn't already set. Once a workspace
// folder is set, subscribes to file-watcher events for that folder and
// invalidates the affected parent dir in sidebarStore on every event.
import { useEffect } from "react";

import styles from "@/components/Sidebar.module.css";
import { SidebarTree } from "@/components/SidebarTree";
import { useMdStore } from "@/store/mdStore";
import { useSidebarStore } from "@/store/sidebarStore";
import { homeDir, listDir, writeTextFile } from "@/lib/fsClient";
import { watchWorkspace } from "@/lib/fileWatcher";

export function Sidebar() {
  const workspaceFolder = useSidebarStore((s) => s.workspaceFolder);
  const filterText = useSidebarStore((s) => s.filterText);
  const setFilter = useSidebarStore((s) => s.setFilter);
  const setWorkspaceFolder = useSidebarStore((s) => s.setWorkspaceFolder);
  const storeEntries = useSidebarStore((s) => s.storeEntries);
  const openMdTab = useMdStore((s) => s.openMdTab);
  const mdEditorMode = useMdStore((s) => s.mdEditorMode);
  const setMdEditorMode = useMdStore((s) => s.setMdEditorMode);

  useEffect(() => {
    if (workspaceFolder === null) {
      void homeDir().then((h) => setWorkspaceFolder(h));
    }
  }, [workspaceFolder, setWorkspaceFolder]);

  useEffect(() => {
    if (workspaceFolder === null) return;

    // Coalesce + filter watcher events. Without this, watching the user's
    // home folder recursively floods the renderer on Windows because
    // AppData / .git / node_modules / browser caches / IDE indexers all
    // generate FS noise. Each raw event becomes a Tauri IPC call into
    // listDir + a store update + a re-render — easily hundreds per second
    // on a busy machine, which shows up to the user as "(not responding)".
    //
    // Two-layer guard:
    //   (a) Drop events whose path is inside a well-known noisy directory.
    //   (b) Coalesce remaining events by their PARENT dir and flush at most
    //       once per 300ms — many events on the same dir collapse into a
    //       single listDir.
    const NOISE_PATTERNS = [
      /[/\\]AppData[/\\]/i,
      /[/\\]\.git([/\\]|$)/i,
      /[/\\]node_modules([/\\]|$)/i,
      /[/\\]\.cache([/\\]|$)/i,
      /[/\\]\.turbo([/\\]|$)/i,
      /[/\\]\.next([/\\]|$)/i,
      /[/\\]target([/\\]|$)/i,
      /[/\\]dist([/\\]|$)/i,
      /[/\\]build([/\\]|$)/i,
      /[/\\]\.venv([/\\]|$)/i,
      /[/\\]__pycache__([/\\]|$)/i,
    ];

    const pendingDirs = new Set<string>();
    let flushTimer: number | null = null;
    const flush = () => {
      flushTimer = null;
      const dirs = Array.from(pendingDirs);
      pendingDirs.clear();
      for (const dir of dirs) {
        void listDir(dir)
          .then((es) => storeEntries(dir, es))
          .catch(() => undefined);
      }
    };
    const schedule = () => {
      if (flushTimer !== null) return;
      flushTimer = window.setTimeout(flush, 300);
    };

    watchWorkspace(workspaceFolder, (e) => {
      if (e.kind === "rescan") {
        void listDir(workspaceFolder)
          .then((es) => storeEntries(workspaceFolder, es))
          .catch(() => undefined);
        return;
      }
      if (NOISE_PATTERNS.some((p) => p.test(e.path))) return;
      const parent = e.path.replace(/[/\\][^/\\]+$/, "");
      if (parent.length === 0) return;
      pendingDirs.add(parent);
      schedule();
    });
  }, [workspaceFolder, storeEntries]);

  const onNewFile = async () => {
    if (workspaceFolder === null) return;
    const name = window.prompt("New file name (relative to workspace)");
    if (!name) return;
    const path = `${workspaceFolder}/${name.endsWith(".md") ? name : `${name}.md`}`;
    try {
      await writeTextFile(path, "");
      // Per CONTEXT.md Sidebar header: ＋ New File opens the new .md in MD
      // Editor Full View, NOT the Quick Viewer.
      await openMdTab(path);
    } catch (e) {
      console.error("new file failed", e);
    }
  };

  if (workspaceFolder === null) {
    return <div className={styles.sidebar}>loading…</div>;
  }

  return (
    <div className={styles.sidebar}>
      <div className={styles.header}>
        <input
          className={styles.filter}
          type="text"
          placeholder="🔍 filter"
          value={filterText}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button
          className={`${styles.iconButton} ${mdEditorMode === "full" ? styles.active : ""}`}
          title={mdEditorMode === "full" ? "Close MD Editor (Ctrl+E)" : "Open MD Editor (Ctrl+E)"}
          onClick={() => setMdEditorMode(mdEditorMode === "full" ? "off" : "full")}
        >
          🗎
        </button>
        <button className={styles.iconButton} title="New .md file" onClick={onNewFile}>
          ＋
        </button>
      </div>
      <div className={styles.tree}>
        <SidebarTree path={workspaceFolder} depth={0} />
      </div>
    </div>
  );
}
