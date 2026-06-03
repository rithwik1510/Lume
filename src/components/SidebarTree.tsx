// Recursive renderer. Reads sidebarStore. Triggers lazy listDir when a folder
// is expanded for the first time.
import { useEffect, type MouseEvent as ReactMouseEvent } from "react";

import { SidebarRow } from "@/components/SidebarRow";
import { beginInternalFileDrag } from "@/lib/internalFileDrag";
import { useContextMenuStore } from "@/store/contextMenuStore";
import { useMdStore } from "@/store/mdStore";
import { useSidebarStore, COLLAPSED_DIRS } from "@/store/sidebarStore";
import { listDir } from "@/lib/fsClient";

interface Props {
  path: string;
  depth: number;
}

export function SidebarTree({ path, depth }: Props) {
  const entries = useSidebarStore((s) => s.entries.get(path));
  const expanded = useSidebarStore((s) => s.expanded);
  const matchesFilter = useSidebarStore((s) => s.matchesFilter);
  const toggleExpanded = useSidebarStore((s) => s.toggleExpanded);
  const storeEntries = useSidebarStore((s) => s.storeEntries);
  const openMdInQuickViewer = useMdStore((s) => s.openMdInQuickViewer);
  const openMdTab = useMdStore((s) => s.openMdTab);

  useEffect(() => {
    if (entries === undefined) {
      listDir(path)
        .then((es) => storeEntries(path, es))
        .catch(() => storeEntries(path, []));
    }
  }, [path, entries, storeEntries]);

  if (entries === undefined) return null;

  return (
    <>
      {entries
        .filter((e) => e.is_dir || matchesFilter(e.name))
        .map((entry) => {
          const isExpanded = expanded.has(entry.path);
          const dimmed = entry.is_dir && COLLAPSED_DIRS.has(entry.name) && !isExpanded;
          const onClick = () => {
            if (entry.is_dir) {
              toggleExpanded(entry.path);
            } else if (entry.name.endsWith(".md")) {
              void openMdInQuickViewer(entry.path).catch((err) => {
                console.error("openMdInQuickViewer failed", err);
              });
            }
          };
          // Right-click on a .md row → context menu with "Open in Editor".
          // Single-click opens the Quick Viewer (glance); explicit intent to
          // open in MD Editor Full View comes via right-click — matches OS
          // conventions and the discoverability gap left by the missing top
          // bar (Weekend 4).
          const onContextMenu = entry.is_dir || !entry.name.endsWith(".md")
            ? undefined
            : (e: ReactMouseEvent<HTMLDivElement>) => {
                e.preventDefault();
                e.stopPropagation();
                useContextMenuStore.getState().openMenu(e.clientX, e.clientY, [
                  {
                    label: "Open in Editor",
                    onClick: () => {
                      void openMdTab(entry.path).catch((err) => {
                        console.error("openMdTab failed", err);
                      });
                    },
                  },
                  {
                    label: "Open in Quick Viewer",
                    onClick: () => {
                      void openMdInQuickViewer(entry.path).catch((err) => {
                        console.error("openMdInQuickViewer failed", err);
                      });
                    },
                  },
                ]);
              };
          // Files can be dragged onto a terminal pane to paste their path into
          // the agent (drag-drop file attach). We use a manual pointer-drag, NOT
          // HTML5 draggable: Tauri's dragDropEnabled (true, needed for the OS
          // drop) suppresses HTML5 dragover/drop on WebView2. Directories aren't
          // draggable — you attach files, not folders. The drag only starts past
          // a movement threshold, so a plain click still opens the Quick Viewer.
          const onMouseDown = entry.is_dir
            ? undefined
            : (e: ReactMouseEvent<HTMLDivElement>) => {
                if (e.button !== 0) return; // left button only
                beginInternalFileDrag(entry.path, e.clientX, e.clientY);
              };
          return (
            <div key={entry.path}>
              <SidebarRow
                name={entry.name}
                isDir={entry.is_dir}
                depth={depth}
                expanded={isExpanded}
                selected={false}
                dimmed={dimmed}
                onClick={onClick}
                onContextMenu={onContextMenu}
                onMouseDown={onMouseDown}
              />
              {entry.is_dir && isExpanded && (
                <SidebarTree path={entry.path} depth={depth + 1} />
              )}
            </div>
          );
        })}
    </>
  );
}
