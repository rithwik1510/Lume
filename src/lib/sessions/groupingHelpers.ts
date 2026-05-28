// Pure helpers for sessionsStore grouping. Kept out of the store file
// because they're trivially unit-testable without Zustand machinery.

/** Last path segment. Handles both forward and back slashes; trims trailing separators. */
export function basename(path: string): string {
  if (path === "") return "";
  const trimmed = path.replace(/[/\\]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

/**
 * Path equality with platform-appropriate semantics:
 *   - On Windows the comparison is case-insensitive (path components compare as
 *     equal regardless of case).
 *   - Trailing slashes are stripped before comparison so "/a/b" === "/a/b/".
 */
export function samePath(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/[/\\]+$/, "");
  const A = norm(a);
  const B = norm(b);
  // Windows detection: path starts with a drive letter or contains backslash.
  const isWin = /^[a-zA-Z]:[\\/]/.test(A) || A.includes("\\") || B.includes("\\");
  return isWin ? A.toLowerCase() === B.toLowerCase() : A === B;
}

/**
 * Given a desired name and the existing sibling names, return either the
 * desired name (if unused) or `name-2`, `name-3`, ... up to the first free.
 */
export function autoSuffixSessionName(desired: string, taken: string[]): string {
  if (!taken.includes(desired)) return desired;
  let i = 2;
  while (taken.includes(`${desired}-${i}`)) i++;
  return `${desired}-${i}`;
}
