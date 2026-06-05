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

  it("adds target=_blank and rel=noopener noreferrer to links", () => {
    const html = renderMarkdown("[x](https://example.com)");
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });
  it("does not produce a clickable link for javascript: hrefs", () => {
    // markdown-it (html:false) does not linkify javascript: hrefs — the input
    // is rendered as literal text, never as <a href="javascript:...">. Confirm
    // there is no executable anchor pointing at a javascript: URL.
    const html = renderMarkdown("[x](javascript:alert(1))");
    expect(html).not.toMatch(/href\s*=\s*["']?javascript:/i);
  });
  it("HTML-escapes raw img tags so onerror cannot execute", () => {
    // markdown-it (html:false) escapes raw HTML; DOMPurify strips event attrs
    // from any element that does survive. Either way, no live <img> with an
    // onerror handler should be present — the tag itself must be escaped away.
    const html = renderMarkdown("<img src=x onerror=alert(1)>");
    // A live unescaped <img element must not appear in the output.
    expect(html).not.toMatch(/<img\b/i);
  });
});
