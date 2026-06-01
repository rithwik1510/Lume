// src/lib/dialogClient.ts
//
// Thin wrapper around @tauri-apps/plugin-dialog's `open()` for an OS
// folder picker. Kept thin so the open-folder action in TopBar /
// keyboard shortcuts is testable by mocking this module.

import { open } from "@tauri-apps/plugin-dialog";

/** Show the OS folder picker. Returns the selected absolute path, or
 *  `null` if the user cancelled. */
export async function pickFolder(): Promise<string | null> {
  const selected = await open({ directory: true, multiple: false });
  if (selected === null) return null;
  // The plugin returns `string | string[] | null` depending on
  // multiple; we asked for single, but narrow defensively.
  if (Array.isArray(selected)) return selected[0] ?? null;
  return selected;
}

/** Show the OS file picker filtered to Markdown files. Returns the selected
 *  absolute path, or `null` if the user cancelled. Used by the MD Editor's
 *  "Open file" button — a friendlier path than typing one into Ctrl+O. */
export async function pickMdFile(): Promise<string | null> {
  const selected = await open({
    directory: false,
    multiple: false,
    filters: [{ name: "Markdown", extensions: ["md", "markdown", "mdx", "txt"] }],
  });
  if (selected === null) return null;
  if (Array.isArray(selected)) return selected[0] ?? null;
  return selected;
}
