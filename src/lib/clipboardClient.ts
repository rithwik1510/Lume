// Clipboard access for the terminals.
//
// Primary path: the Tauri clipboard-manager plugin. It reads/writes on the Rust
// host via the OS clipboard, so it works regardless of WebView2 document focus
// or user-activation state. That focus/gesture requirement is exactly what made
// `navigator.clipboard` fail intermittently ("copy works sometimes") and what
// makes it reject OSC 52 writes outright — those fire from terminal output,
// never a user gesture, so the browser API refuses them.
//
// Fallback path: `navigator.clipboard`, kept for resilience if the host command
// is ever unavailable. Both calls swallow errors — a blocked or empty clipboard
// must never throw into the xterm key handler or the OSC 52 parser; read
// returns "" on failure.

import {
  readText as hostReadText,
  writeText as hostWriteText,
} from "@tauri-apps/plugin-clipboard-manager";

export async function writeClipboardText(text: string): Promise<void> {
  try {
    await hostWriteText(text);
    return;
  } catch (err) {
    console.warn("clipboard write via host plugin failed; trying navigator", err);
  }
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    }
  } catch (err) {
    console.warn("clipboard write failed", err);
  }
}

export async function readClipboardText(): Promise<string> {
  try {
    return await hostReadText();
  } catch (err) {
    console.warn("clipboard read via host plugin failed; trying navigator", err);
  }
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.readText) {
      return await navigator.clipboard.readText();
    }
  } catch (err) {
    console.warn("clipboard read failed", err);
  }
  return "";
}
