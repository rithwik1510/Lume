// Detects .md file references in terminal output and exposes a click
// handler for xterm.js's registerLinkProvider.
//
// Per DESIGN.md §12 W3 #6: PTY *bytes* never touch Zustand stores, but
// xterm.js link-provider lookups can call useMdStore.getState() and
// usePtyStore.getState() synchronously inside the activate handler —
// that's fine, it's not on the byte-streaming path.

import type { IDisposable, ILink, ILinkProvider, Terminal } from "@xterm/xterm";

import { useMdStore } from "@/store/mdStore";
import { usePtyStore } from "@/store/ptyStore";
import { useSessionsStore, findSessionForPane } from "@/store/sessionsStore";
import type { PaneId } from "@/types";

const MD_LINK_REGEX =
  /(?:[A-Za-z]:[\\/][^\s"'`<>]+\.md|\.{1,2}[\\/][^\s"'`<>]+\.md|[A-Za-z0-9_.\-/\\]+\.md)/g;

export interface MdLinkMatch {
  text: string;
  start: number;
  end: number;
}

export function findMdLinks(line: string): MdLinkMatch[] {
  const out: MdLinkMatch[] = [];
  for (const m of line.matchAll(MD_LINK_REGEX)) {
    if (m.index === undefined) continue;
    out.push({ text: m[0], start: m.index, end: m.index + m[0].length });
  }
  return out;
}

export function isAbsolute(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("/") || path.startsWith("\\\\");
}

export function resolveMdPath(path: string, cwd: string | null): string | null {
  if (isAbsolute(path)) return path;
  if (cwd === null) return null;
  return `${cwd}/${path}`;
}

/** xterm's mouse-tracking mode. `"none"` means no TUI is capturing the mouse
 *  (a bare shell prompt); any other value means a TUI — Claude Code, Codex,
 *  vim — owns the mouse, so plain clicks are forwarded to it. Mirrors
 *  `Terminal.modes.mouseTrackingMode` from @xterm/xterm. */
export type MouseTrackingMode = "none" | "x10" | "vt200" | "drag" | "any";

/**
 * Decide whether a click on an MD link should follow the link or fall through
 * to the terminal. In a plain shell (no mouse capture) any click follows the
 * link. When a TUI owns the mouse a bare click is *its* click — only
 * Ctrl/Cmd+Click follows the link. This matches the README's documented gesture
 * and stops us from stealing clicks meant for the agent.
 */
export function shouldActivateMdLink(
  mouseMode: MouseTrackingMode,
  event: { ctrlKey: boolean; metaKey: boolean }
): boolean {
  if (mouseMode === "none") return true;
  return event.ctrlKey || event.metaKey;
}

/**
 * Ordered list of absolute paths to try for a clicked link, most-likely first.
 * Absolute links resolve to themselves. Relative links resolve against the
 * pane's cwd first (where the shell launched) and then the owning session's
 * folder as a fallback — deduped. The opener tries each until one reads, which
 * gives "open the right file" precision without an fs stat on the hot hover
 * path. (Live per-line cwd via OSC 7 is the real fix — deferred to v0.2.)
 */
export function mdLinkCandidates(
  text: string,
  cwd: string | null,
  folder: string | null
): string[] {
  if (isAbsolute(text)) return [text];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const base of [cwd, folder]) {
    const resolved = resolveMdPath(text, base);
    if (resolved !== null && !seen.has(resolved)) {
      seen.add(resolved);
      out.push(resolved);
    }
  }
  return out;
}

export function buildMdLinkProvider(
  term: Terminal,
  paneId: PaneId
): ILinkProvider {
  return {
    provideLinks(
      bufferLineNumber: number,
      callback: (links: ILink[] | undefined) => void
    ): void {
      const buf = term.buffer.active;
      const line = buf.getLine(bufferLineNumber - 1);
      if (!line) return callback(undefined);
      const text = line.translateToString();
      const matches = findMdLinks(text);
      if (matches.length === 0) return callback(undefined);
      const links: ILink[] = matches.map((m) => ({
        range: {
          start: { x: m.start + 1, y: bufferLineNumber },
          end: { x: m.end, y: bufferLineNumber },
        },
        text: m.text,
        activate: (event, t) => {
          // Gesture gate: a TUI (Claude Code, Codex, vim) owns the mouse, so a
          // bare click is theirs — only Ctrl/Cmd+Click follows the link. In a
          // plain shell any click follows it. Bail without opening (and without
          // consuming the click) when the gesture doesn't qualify.
          if (!shouldActivateMdLink(term.modes.mouseTrackingMode, event)) return;
          // ptyStore.panes is a Record<PaneId, PaneMetadata>, not a Map.
          const meta = usePtyStore.getState().panes[paneId];
          const session = findSessionForPane(useSessionsStore.getState(), paneId);
          const folder = session?.folderPath ?? meta?.cwd ?? null;
          const candidates = mdLinkCandidates(t, meta?.cwd ?? null, folder);
          if (candidates.length === 0 && folder === null) return;
          // searchRoot lets the opener find a bare filename that lives in a
          // subfolder of the session (the agent printed "PLAN.md", not
          // "docs/PLAN.md"). Null when we have no folder to search.
          void useMdStore.getState().openMdLinkInQuickViewer(candidates, t, folder);
        },
      }));
      callback(links);
    },
  };
}

export function registerMdLinkProvider(
  term: Terminal,
  paneId: PaneId
): IDisposable {
  return term.registerLinkProvider(buildMdLinkProvider(term, paneId));
}
