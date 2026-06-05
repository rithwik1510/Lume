// commandCapture — reconstructs the FIRST command line a user types into a
// freshly-spawned pane, from the raw keystroke stream that flows to the PTY.
//
// This is intentionally a heuristic. Reconstructing a shell line from raw bytes
// can't perfectly account for history recall, tab-completion, or multi-line
// editing. That's acceptable here because the captured command is only
// PRE-FILLED at the prompt on session revive — never executed — so a slightly
// imperfect capture is something the user simply edits or clears before
// pressing Enter.
//
// Handled: printable ASCII and astral codepoints, Backspace/Delete (erases the
// last CODEPOINT, surrogate-pair safe), Enter (CR/LF → finalize), OSC title
// sequences (ESC ] … BEL/ST), CSI sequences with any final byte 0x40-0x7E
// (covers arrow keys, Delete ESC[3~, bracketed-paste ESC[200~/ESC[201~), SS3
// function-key sequences (ESC O <byte>), and 2-byte ESC sequences (Alt+key).
// It's single-shot: once it finalizes a line it returns null forever after.

export interface CommandCapture {
  /**
   * Feed a chunk of raw terminal input (the same string handed to the PTY).
   * Returns the finalized command line (trimmed of surrounding whitespace,
   * possibly empty) the first time Enter is seen; otherwise null.
   */
  feed(chunk: string): string | null;
}

export function makeCommandCapture(): CommandCapture {
  let buf = "";
  let done = false;
  // ESC sequence state. "none" = normal; "esc" = just saw ESC (decide type from
  // next byte); "csi" = ESC[ … final 0x40-0x7E; "osc" = ESC] … BEL or ST(ESC\);
  // "ss3" = ESC O <one byte>.
  let esc: "none" | "esc" | "csi" | "osc" | "ss3" = "none";
  let oscSawEsc = false; // inside OSC, previous byte was ESC (possible ST: ESC \)

  return {
    feed(chunk: string): string | null {
      if (done) return null;
      for (const ch of chunk) {
        const code = ch.codePointAt(0) ?? 0;

        if (esc === "esc") {
          if (ch === "[") esc = "csi";
          else if (ch === "]") {
            esc = "osc";
            oscSawEsc = false;
          } else if (ch === "O") esc = "ss3";
          else esc = "none"; // 2-byte ESC seq (e.g. Alt+key) — consume the byte
          continue;
        }
        if (esc === "ss3") {
          esc = "none"; // SS3 consumes exactly one final byte
          continue;
        }
        if (esc === "csi") {
          // CSI ends on a final byte in 0x40-0x7E (covers letters, ~, @, etc.)
          if (code >= 0x40 && code <= 0x7e) esc = "none";
          continue;
        }
        if (esc === "osc") {
          if (code === 0x07) {
            esc = "none"; // BEL terminator
            oscSawEsc = false;
          } else if (oscSawEsc) {
            esc = "none"; // ESC \ (ST) or any ESC-led terminator — OSC ends
            oscSawEsc = false;
          } else if (code === 0x1b) {
            oscSawEsc = true; // maybe ST next
          }
          continue;
        }

        // esc === "none"
        if (code === 0x1b) {
          esc = "esc";
          continue;
        }
        if (code === 13 || code === 10) {
          done = true;
          return buf.trim();
        }
        if (code === 127 || code === 8) {
          // Backspace — drop the last CODEPOINT (Array.from is surrogate-aware).
          const arr = Array.from(buf);
          arr.pop();
          buf = arr.join("");
          continue;
        }
        if (code < 0x20) continue; // other control chars (Tab, Ctrl-*) ignored
        buf += ch;
      }
      return null;
    },
  };
}
