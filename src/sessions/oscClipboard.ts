// OSC 52 — clipboard set/query from inside the terminal.
//
// Wire format: ESC ] 52 ; Pc ; Pd BEL  (xterm hands the handler just "Pc;Pd").
//   Pc = target selection(s): c=clipboard, p=primary, s/q/0-7=other buffers.
//   Pd = base64 payload to COPY, or "?" to READ the clipboard back.
//
// This is how TUIs (Claude Code, vim, tmux, nvim, lazygit, …) push their own
// selection onto the system clipboard. xterm.js ignores OSC 52 by default, so
// before this handler "copy from the agent" silently did nothing.
//
// We honor WRITES only, and route them through the Tauri host clipboard: a write
// that fires from terminal output has no user gesture, so navigator.clipboard
// would reject it. We deliberately DENY reads (Pc;?) — answering them would let
// any program that prints an escape sequence exfiltrate whatever is on your
// clipboard. (Matches xterm's safe default.)

import type { Terminal } from "@xterm/xterm";
import { writeClipboardText } from "@/lib/clipboardClient";

export type Osc52Action =
  | { kind: "write"; text: string }
  | { kind: "deny" } // a read query (Pc;?) — refused for security
  | { kind: "ignore" }; // malformed / empty / undecodable — absorb, do nothing

/**
 * Decode an OSC 52 payload ("Pc;Pd") into an action. Pure + unit-testable; the
 * side-effecting clipboard write lives in the handler below.
 */
export function parseOsc52(data: string): Osc52Action {
  const sep = data.indexOf(";");
  if (sep === -1) return { kind: "ignore" };
  const payload = data.slice(sep + 1);
  if (payload === "?") return { kind: "deny" };
  if (payload === "") return { kind: "ignore" }; // empty = clear; we don't clobber
  const text = decodeBase64Utf8(payload);
  if (text === null || text.length === 0) return { kind: "ignore" };
  return { kind: "write", text };
}

/** base64 → UTF-8 string; null on invalid input (never throws). */
function decodeBase64Utf8(b64: string): string | null {
  try {
    const binary = atob(b64.trim());
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/** Register the OSC 52 handler on a Terminal. Returns a disposer. */
export function registerClipboardOsc(term: Terminal): () => void {
  const d = term.parser.registerOscHandler(52, (data: string) => {
    const action = parseOsc52(data);
    if (action.kind === "write") {
      void writeClipboardText(action.text);
    }
    // Absorb the sequence in every case (write / deny / ignore) so it never
    // reaches a default handler or prints to the screen as garbage.
    return true;
  });
  return () => d.dispose();
}
