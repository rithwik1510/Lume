import { describe, expect, it } from "vitest";
import { parseOsc52 } from "@/sessions/oscClipboard";

// base64 of a UTF-8 string — matches what a TUI emits in OSC 52.
function b64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

describe("parseOsc52", () => {
  it("decodes a clipboard write (c;<base64>)", () => {
    expect(parseOsc52(`c;${b64("hello world")}`)).toEqual({
      kind: "write",
      text: "hello world",
    });
  });

  it("decodes UTF-8 payloads correctly", () => {
    expect(parseOsc52(`c;${b64("café — 你好")}`)).toEqual({
      kind: "write",
      text: "café — 你好",
    });
  });

  it("accepts an empty Pc selection field (;<base64>)", () => {
    expect(parseOsc52(`;${b64("hi")}`)).toEqual({ kind: "write", text: "hi" });
  });

  it("accepts multi-target selections (e.g. cp)", () => {
    expect(parseOsc52(`cp;${b64("multi")}`)).toEqual({
      kind: "write",
      text: "multi",
    });
  });

  it("denies a read query (Pc;?) for security", () => {
    expect(parseOsc52("c;?")).toEqual({ kind: "deny" });
  });

  it("ignores an empty payload (clear request) rather than clobbering", () => {
    expect(parseOsc52("c;")).toEqual({ kind: "ignore" });
  });

  it("ignores a malformed sequence with no separator", () => {
    expect(parseOsc52("garbage")).toEqual({ kind: "ignore" });
  });

  it("ignores an undecodable base64 payload", () => {
    expect(parseOsc52("c;@@@@")).toEqual({ kind: "ignore" });
  });
});
