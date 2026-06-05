// src/lib/attachPath.ts
//
// Pure path formatting for drag-and-drop file attach. No I/O. Turns an
// absolute filesystem path into the string we paste into a terminal:
//   - relative to the session folder when the file lives under it (shorter,
//     and it's what an agent already-rooted there expects),
//   - otherwise the absolute path (the external-file case),
//   - quoted when it contains whitespace.
// Separators in the relativized result are normalized to "/" — Claude Code and
// Codex both accept forward slashes on Windows, and it sidesteps escaping.

/** Private vendor MIME type for in-app file drags (sidebar row → pane). */
export const LUME_FILE_MIME = "application/x-lume-file";

function normalizeForCompare(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

/** The path of `filePath` relative to `folder`, forward-slashed, or null when
 *  `filePath` is not strictly inside `folder`. */
export function relativeUnder(filePath: string, folder: string): string | null {
  const folderNorm = normalizeForCompare(folder);
  const fileFwd = filePath.replace(/\\/g, "/");
  const fileLower = fileFwd.toLowerCase().replace(/\/+$/, "");
  if (fileLower === folderNorm) return null;
  const prefix = folderNorm + "/";
  if (!fileLower.startsWith(prefix)) return null;
  return fileFwd.slice(prefix.length);
}

/** Double-quote the path if it contains any whitespace. */
export function quoteIfNeeded(p: string): string {
  return /\s/.test(p) ? `"${p}"` : p;
}

/** The string to paste into a terminal for `filePath`, given the owning
 *  session's folder (or null when unknown). */
export function formatAttachPath(filePath: string, sessionFolder: string | null): string {
  // Strip control characters (incl. CR/LF and terminal escape bytes). A crafted
  // filename with \r would otherwise submit the line when pasted into a pane,
  // and ANSI/OSC sequences would reach the terminal. Control chars are illegal
  // in Windows filenames, so this never affects legitimate paths.
  const safe = filePath.replace(/[\x00-\x1f\x7f]/g, "");
  const rel = sessionFolder ? relativeUnder(safe, sessionFolder) : null;
  return quoteIfNeeded(rel ?? safe);
}
