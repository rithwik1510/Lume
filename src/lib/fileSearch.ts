// Bounded breadth-first file search under a root folder.
//
// Why: agents (and humans) routinely print a *bare* filename — "see
// PLAN.md" — when the file actually lives in a subfolder (docs/PLAN.md).
// Resolving such a link against the cwd root alone misses it. When direct
// resolution fails, we fall back to searching the session folder for the
// basename. BFS so the shallowest match wins (docs/PLAN.md before
// deep/nested/PLAN.md), and bounded so a click never walks a giant tree.

import { listDir } from "@/lib/fsClient";
import type { DirEntry } from "@/types/fs";

/** Heavy / generated dirs we never descend into during a link search. */
const SEARCH_NOISE =
  /^(node_modules|\.git|\.cache|\.turbo|\.next|target|dist|build|\.venv|__pycache__|AppData|\.svn|\.hg|vendor|coverage)$/i;

export interface FindOpts {
  /** Cap on directories visited before giving up (keeps a click cheap). */
  maxDirs?: number;
  /** Cap on recursion depth below the root. */
  maxDepth?: number;
}

export interface SearchOpts extends FindOpts {
  /** Cap on returned matches. */
  maxResults?: number;
  /** Include matching directories as rows as well as files. */
  includeDirs?: boolean;
}

export interface FileSearchResult {
  entry: DirEntry;
  /** Slash-normalized path relative to the search root. */
  relativePath: string;
  /** Slash-normalized parent path relative to the search root. */
  parentRelativePath: string;
  score: number;
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

const FUZZY_SEPARATORS = /[\s_.\-\\/]+/g;

function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, "/");
}

function stripTrailingSlash(path: string): string {
  return normalizeSlashes(path).replace(/\/+$/, "");
}

function compactSearchText(value: string): string {
  return value.toLowerCase().replace(FUZZY_SEPARATORS, "");
}

function relativeToRoot(root: string, path: string): string {
  const cleanRoot = stripTrailingSlash(root);
  const cleanPath = normalizeSlashes(path);
  if (cleanPath.toLowerCase() === cleanRoot.toLowerCase()) return "";
  const prefix = `${cleanRoot}/`;
  if (cleanPath.toLowerCase().startsWith(prefix.toLowerCase())) {
    return cleanPath.slice(prefix.length);
  }
  return cleanPath;
}

function parentRelativePath(relativePath: string): string {
  const idx = relativePath.lastIndexOf("/");
  return idx === -1 ? "" : relativePath.slice(0, idx);
}

function scoreEntry(entry: DirEntry, relativePath: string, query: string): number | null {
  const name = entry.name.toLowerCase();
  const rel = relativePath.toLowerCase();
  const compactQuery = compactSearchText(query);
  const compactName = compactSearchText(entry.name);
  const compactRel = compactSearchText(relativePath);

  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  if (name.includes(query)) return 2;
  if (rel.includes(query)) return 3;
  if (compactQuery.length > 0 && compactName.includes(compactQuery)) return 4;
  if (compactQuery.length > 0 && compactRel.includes(compactQuery)) return 5;
  return null;
}

function sortSearchResults(a: FileSearchResult, b: FileSearchResult): number {
  if (a.score !== b.score) return a.score - b.score;
  if (a.entry.is_dir !== b.entry.is_dir) return a.entry.is_dir ? 1 : -1;
  const aDepth = a.relativePath.split("/").length;
  const bDepth = b.relativePath.split("/").length;
  if (aDepth !== bDepth) return aDepth - bDepth;
  return a.relativePath.localeCompare(b.relativePath, undefined, { sensitivity: "base" });
}

/**
 * Ranked recursive search for the file drawer.
 *
 * It walks breadth-first and skips generated/heavy folders, but unlike the
 * visible tree filter it searches folders that have not been expanded yet.
 * Never throws — unreadable folders are skipped so typing in the drawer stays
 * responsive even in mixed workspaces.
 */
export async function searchFiles(
  root: string,
  rawQuery: string,
  opts: SearchOpts = {}
): Promise<FileSearchResult[]> {
  const query = rawQuery.trim().toLowerCase();
  if (query.length === 0) return [];

  const maxDirs = opts.maxDirs ?? 1_200;
  const maxDepth = opts.maxDepth ?? 9;
  const maxResults = opts.maxResults ?? 120;
  const includeDirs = opts.includeDirs ?? true;
  const candidateCap = Math.max(maxResults * 3, maxResults);
  let scanned = 0;
  const candidates: FileSearchResult[] = [];
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];

  while (queue.length > 0) {
    const { dir, depth } = queue.shift()!;
    if (scanned++ >= maxDirs) break;

    let entries: DirEntry[];
    try {
      entries = await listDir(dir);
    } catch {
      continue;
    }

    const subdirs: DirEntry[] = [];
    for (const entry of entries) {
      const relativePath = relativeToRoot(root, entry.path);
      const score = scoreEntry(entry, relativePath, query);
      if (score !== null && (includeDirs || !entry.is_dir)) {
        candidates.push({
          entry,
          relativePath,
          parentRelativePath: parentRelativePath(relativePath),
          score,
        });
      }

      if (entry.is_dir && depth < maxDepth && !SEARCH_NOISE.test(entry.name)) {
        subdirs.push(entry);
      }
    }

    if (candidates.length > candidateCap) {
      candidates.sort(sortSearchResults);
      candidates.splice(candidateCap);
    }

    for (const subdir of subdirs) queue.push({ dir: subdir.path, depth: depth + 1 });
  }

  return candidates.sort(sortSearchResults).slice(0, maxResults);
}
