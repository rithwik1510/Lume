// Clipboard access for the terminals. Uses the WebView2 `navigator.clipboard`
// API — Tauri webviews run in a secure context, so it's available without a
// Rust plugin. Both calls swallow errors (a blocked or empty clipboard must
// never throw into the xterm key handler); read returns "" on failure.
//
// If readText is ever blocked by the webview's permission policy (paste stops
// working), the fallback is the @tauri-apps/plugin-clipboard-manager plugin —
// that needs a Rust rebuild + a capability grant, so we try the lighter
// browser API first.

export async function readClipboardText(): Promise<string> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.readText) {
      return await navigator.clipboard.readText();
    }
  } catch (err) {
    console.warn("clipboard read failed", err);
  }
  return "";
}

export async function writeClipboardText(text: string): Promise<void> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    }
  } catch (err) {
    console.warn("clipboard write failed", err);
  }
}
