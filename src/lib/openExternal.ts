// src/lib/openExternal.ts
//
// Open a URL in the user's real default browser — the escape hatch for dev
// servers that refuse to be iframed (X-Frame-Options / frame-ancestors CSP).
// Thin so callers can mock it. Uses the shell plugin's opener.

import { open } from "@tauri-apps/plugin-shell";

export async function openExternal(url: string): Promise<void> {
  await open(url);
}
