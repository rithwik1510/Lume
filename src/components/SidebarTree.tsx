// Recursive renderer. Reads sidebarStore. Triggers lazy listDir when a folder
// is expanded for the first time.
import { useEffect } from "react";

import { SidebarRow } from "@/components/SidebarRow";
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
