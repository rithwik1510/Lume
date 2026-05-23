// Sidebar root: header (filter + new file) + tree. On first mount, sets
// the workspace folder to home dir if it isn't already set. Once a workspace
// folder is set, subscribes to file-watcher events for that folder and
// invalidates the affected parent dir in sidebarStore on every event.
import { useEffect } from "react";

import styles from "@/components/Sidebar.module.css";
import { SidebarTree } from "@/components/SidebarTree";
import { useSidebarStore } from "@/store/sidebarStore";
import { homeDir, listDir, writeTextFile } from "@/lib/fsClient";
import { watchWorkspace } from "@/lib/fileWatcher";

export function Sidebar() {
  const workspaceFolder = useSidebarStore((s) => s.workspaceFolder);
  const filterText = useSidebarStore((s) => s.filterText);
  const setFilter = useSidebarStore((s) => s.setFilter);
  const setWorkspaceFolder = useSidebarStore((s) => s.setWorkspaceFolder);
  const storeEntries = useSidebarStore((s) => s.storeEntries);

  useEffect(() => {
    if (workspaceFolder === null) {
      void homeDir().then((h) => setWorkspaceFolder(h));
    }
  }, [workspaceFolder, setWorkspaceFolder]);

  useEffect(() => {
    if (workspaceFolder === null) return;
    watchWorkspace(workspaceFolder, (e) => {
      if (e.kind === "rescan") {
        void listDir(workspaceFolder)
          .then((es) => storeEntries(workspaceFolder, es))
          .catch(() => undefined);
        return;
      }
      const parent = e.path.replace(/[/\\][^/\\]+$/, "");
      if (parent.length > 0) {
        void listDir(parent)
          .then((es) => storeEntries(parent, es))
          .catch(() => undefined);
      }
    });
  }, [workspaceFolder, storeEntries]);

  const onNewFile = async () => {
    if (workspaceFolder === null) return;
    const name = window.prompt("New file name (relative to workspace)");
    if (!name) return;
    const path = `${workspaceFolder}/${name.endsWith(".md") ? name : `${name}.md`}`;
    try {
      await writeTextFile(path, "");
      // Phase 4 will open this in the MD Editor; for Phase 2 the file
      // simply exists on disk and shows up in the tree via the file watcher.
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
