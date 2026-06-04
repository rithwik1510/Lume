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
});
