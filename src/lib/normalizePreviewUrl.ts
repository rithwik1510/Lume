// src/lib/normalizePreviewUrl.ts
//
// Turn what a user types into the preview URL bar into a loadable URL.
//   ""            -> null   (nothing to load)
//   "3000"        -> http://localhost:3000
//   "localhost:5173" / "127.0.0.1:8080" / "host/path" -> http:// prefixed
//   "http(s)://…" -> unchanged
// Defaults to http:// because local dev servers almost never use TLS.

export function normalizePreviewUrl(input: string): string | null {
  const t = input.trim();
  if (t === "") return null;
  if (/^(javascript|data|file|vbscript|blob):/i.test(t)) return null;
  if (/^https?:\/\//i.test(t)) return t;
  if (/^\d{2,5}$/.test(t)) return `http://localhost:${t}`;
  return `http://${t}`;
}
