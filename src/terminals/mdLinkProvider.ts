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
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("/");
}

export function resolveMdPath(path: string, cwd: string | null): string | null {
  if (isAbsolute(path)) return path;
  if (cwd === null) return null;
  return `${cwd}/${path}`;
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
        activate: (_event, t) => {
          // ptyStore.panes is a Record<PaneId, PaneMetadata>, not a Map.
          const meta = usePtyStore.getState().panes[paneId];
          const resolved = resolveMdPath(t, meta?.cwd ?? null);
          if (resolved !== null) {
            void useMdStore.getState().openMdInQuickViewer(resolved);
          }
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
