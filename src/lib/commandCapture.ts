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
// Handled: printable ASCII, Backspace/Delete (erases the last char), Enter
// (CR/LF → finalize), and CSI/escape sequences such as arrow keys (skipped, so
// they don't pollute the captured text). It's single-shot: once it finalizes a
// line it returns null forever after.

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
  let inEsc = false; // inside an ESC/CSI sequence (e.g. arrow keys)

  return {
    feed(chunk: string): string | null {
      if (done) return null;
      for (const ch of chunk) {
        const code = ch.charCodeAt(0);

        if (inEsc) {
          // A CSI sequence (ESC [ … letter) ends on an alphabetic final byte.
          // Skip everything up to and including that letter.
          if ((code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a)) {
            inEsc = false;
          }
          continue;
        }

        if (code === 0x1b) {
          // ESC — start of an escape/CSI sequence; ignore it and its payload.
          inEsc = true;
          continue;
        }
        if (code === 13 || code === 10) {
          // CR or LF — the user submitted the line.
          done = true;
          return buf.trim();
        }
        if (code === 127 || code === 8) {
          // DEL / Backspace — erase the last character.
          buf = buf.slice(0, -1);
          continue;
        }
        if (code < 0x20) {
          // Other control characters (Tab, Ctrl-*, etc.) — ignore.
          continue;
        }
        buf += ch;
      }
      return null;
    },
  };
}
