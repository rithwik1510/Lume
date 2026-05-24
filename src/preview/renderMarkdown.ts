// src/preview/renderMarkdown.ts
// DESIGN.md §4: markdown-it locked to { html: false, linkify: true, breaks: true }
// because the Preview Pane renders inside the Tauri webview which has Tauri
// command access — embedded HTML would be an XSS vector. DOMPurify runs as
// defence-in-depth before injection.

import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";

const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

export function renderMarkdown(src: string): string {
  const rawHtml = md.render(src);
  return DOMPurify.sanitize(rawHtml, { USE_PROFILES: { html: true } });
}
