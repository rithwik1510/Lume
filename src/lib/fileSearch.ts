// Bounded breadth-first file search under a root folder.
//
// Why: agents (and humans) routinely print a *bare* filename — "see
// PLAN.md" — when the file actually lives in a subfolder (docs/PLAN.md).
// Resolving such a link against the cwd root alone misses it. When direct
// resolution fails, we fall back to searching the session folder for the
// basename. BFS so the shallowest match wins (docs/PLAN.md before
// deep/nested/PLAN.md), and bounded so a click never walks a giant tree.

import { listDir } from "@/lib/fsClient";

/** Heavy / generated dirs we never descend into during a link search. */
const SEARCH_NOISE =
  /^(node_modules|\.git|\.cache|\.turbo|\.next|target|dist|build|\.venv|__pycache__|AppData|\.svn|\.hg|vendor|coverage)$/i;

export interface FindOpts {
  /** Cap on directories visited before giving up (keeps a click cheap). */
  maxDirs?: number;
  /** Cap on recursion depth below the root. */
  maxDepth?: number;
}

/**
 * Find the first file named `name` (case-insensitive — Windows fs) anywhere
 * under `root`, breadth-first. Returns its absolute path, or null if not found
 * within the bounds. Never throws — an unreadable dir is skipped.
 */
export async function findFileByName(
  root: string,
  name: string,
  opts: FindOpts = {}
): Promise<string | null> {
  const maxDirs = opts.maxDirs ?? 600;
  const maxDepth = opts.maxDepth ?? 6;
  const target = name.toLowerCase();
  let scanned = 0;
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];

  while (queue.length > 0) {
    const { dir, depth } = queue.shift()!;
    if (scanned++ >= maxDirs) break;

    let entries;
    try {
      entries = await listDir(dir);
    } catch {
      continue; // unreadable / vanished dir — skip
    }

    const subdirs: string[] = [];
    for (const e of entries) {
      if (e.is_dir) {
        if (depth < maxDepth && !SEARCH_NOISE.test(e.name)) subdirs.push(e.path);
      } else if (e.name.toLowerCase() === target) {
        return e.path; // shallowest match wins (BFS)
      }
    }
    for (const sd of subdirs) queue.push({ dir: sd, depth: depth + 1 });
  }
  return null;
}
