import { describe, it, expect } from "vitest";
import { shouldSkipShortcut } from "@/hooks/shortcutTarget";

function el(tag: string, opts: { contentEditable?: boolean; parentClass?: string } = {}) {
  const node = document.createElement(tag);
  if (opts.contentEditable) node.setAttribute("contenteditable", "true");
  if (opts.parentClass) {
    const parent = document.createElement("div");
    parent.className = opts.parentClass;
    parent.appendChild(node);
  }
  return node;
}

describe("shouldSkipShortcut", () => {
  it("skips when target is a plain text input", () => {
    expect(shouldSkipShortcut(el("input"))).toBe(true);
  });
  it("skips when target is a textarea", () => {
    expect(shouldSkipShortcut(el("textarea"))).toBe(true);
  });
  it("skips when target is contentEditable", () => {
    expect(shouldSkipShortcut(el("div", { contentEditable: true }))).toBe(true);
  });
  it("does NOT skip the xterm helper textarea (terminal must keep its shortcuts)", () => {
    const ta = el("textarea", { parentClass: "xterm" });
    expect(shouldSkipShortcut(ta)).toBe(false);
  });
  it("does NOT skip a non-editable target (button, div)", () => {
    expect(shouldSkipShortcut(el("button"))).toBe(false);
    expect(shouldSkipShortcut(el("div"))).toBe(false);
  });
  it("does NOT skip when target is null", () => {
    expect(shouldSkipShortcut(null)).toBe(false);
  });
});
