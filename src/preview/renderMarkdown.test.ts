// src/preview/renderMarkdown.test.ts
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "@/preview/renderMarkdown";

describe("renderMarkdown", () => {
  it("renders headings", () => {
    expect(renderMarkdown("# Hello")).toContain("<h1>Hello</h1>");
  });

  it("does not render raw HTML (XSS guard)", () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\n# After');
    expect(html).not.toContain("<script>");
    expect(html).toContain("<h1>After</h1>");
  });

  it("linkifies URLs", () => {
    expect(renderMarkdown("see https://example.com here")).toContain("<a");
  });

  it("renders fenced code as <pre><code>", () => {
    const html = renderMarkdown("```ts\nlet x = 1\n```");
    expect(html).toMatch(/<pre><code/);
  });
});
