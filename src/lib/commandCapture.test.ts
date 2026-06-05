import { describe, it, expect } from "vitest";

import { makeCommandCapture } from "@/lib/commandCapture";

describe("commandCapture", () => {
  it("captures a simple command submitted with CR", () => {
    const c = makeCommandCapture();
    expect(c.feed("claude\r")).toBe("claude");
  });

  it("accepts LF as a submit too", () => {
    const c = makeCommandCapture();
    expect(c.feed("codex\n")).toBe("codex");
  });

  it("accumulates across multiple chunks (char-by-char typing)", () => {
    const c = makeCommandCapture();
    expect(c.feed("c")).toBeNull();
    expect(c.feed("l")).toBeNull();
    expect(c.feed("a")).toBeNull();
    expect(c.feed("ude")).toBeNull();
    expect(c.feed("\r")).toBe("claude");
  });

  it("handles backspace (DEL 0x7f) by erasing the last char", () => {
    const c = makeCommandCapture();
    // type "claude", backspace twice → "clau", then "de"
    expect(c.feed("claude")).toBeNull();
    expect(c.feed("\x7f\x7f")).toBeNull();
    expect(c.feed("de\r")).toBe("claude");
  });

  it("handles backspace (BS 0x08) too", () => {
    const c = makeCommandCapture();
    expect(c.feed("lsx\x08\r")).toBe("ls");
  });

  it("ignores arrow-key / CSI escape sequences", () => {
    const c = makeCommandCapture();
    // type "claude", then a left-arrow (ESC [ D) which should NOT add "[D"
    expect(c.feed("claude\x1b[D\r")).toBe("claude");
  });

  it("ignores other control chars (Tab, Ctrl-keys)", () => {
    const c = makeCommandCapture();
    expect(c.feed("cla\tude\r")).toBe("claude");
  });

  it("trims surrounding whitespace", () => {
    const c = makeCommandCapture();
    expect(c.feed("  claude  \r")).toBe("claude");
  });

  it("is single-shot: returns null after the first finalized line", () => {
    const c = makeCommandCapture();
    expect(c.feed("claude\r")).toBe("claude");
    expect(c.feed("codex\r")).toBeNull();
    expect(c.feed("anything\r")).toBeNull();
  });

  it("an empty line finalizes to an empty string (caller decides to ignore)", () => {
    const c = makeCommandCapture();
    expect(c.feed("\r")).toBe("");
  });

  it("does not leak OSC title text into the command", () => {
    const c = makeCommandCapture();
    // ESC ] 0 ; some-title BEL  then the real command
    expect(c.feed("\x1b]0;my-title\x07npm run dev\r")).toBe("npm run dev");
  });

  it("skips a CSI sequence with a non-alpha final (Delete = ESC [ 3 ~)", () => {
    const c = makeCommandCapture();
    expect(c.feed("ab\x1b[3~cd\n")).toBe("abcd");
  });

  it("skips bracketed-paste markers", () => {
    const c = makeCommandCapture();
    expect(c.feed("\x1b[200~pasted\x1b[201~\r")).toBe("pasted");
  });

  it("skips an SS3 sequence (ESC O P = F1)", () => {
    const c = makeCommandCapture();
    expect(c.feed("x\x1bOPy\n")).toBe("xy");
  });

  it("backspaces a full astral codepoint", () => {
    const c = makeCommandCapture();
    // type an emoji then backspace then a letter
    expect(c.feed("\u{1F600}\x7fz\r")).toBe("z");
  });

  it("returns empty string when Enter is pressed on an empty line", () => {
    const c = makeCommandCapture();
    expect(c.feed("\r")).toBe("");
  });
});
