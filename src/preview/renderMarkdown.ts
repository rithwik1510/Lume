// src/preview/renderMarkdown.ts
// DESIGN.md §4: markdown-it locked to { html: false, linkify: true, breaks: true }
// because the Preview Pane renders inside the Tauri webview which has Tauri
// command access — embedded HTML would be an XSS vector. DOMPurify runs as
// defence-in-depth before injection.

import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";

const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

// Harden all anchors produced by markdown-it / linkify: force them to open in
// a new tab and strip the opener reference so the linked page cannot navigate
// the Tauri webview away (reverse-tabnapping). Registered once at module level.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

export function renderMarkdown(src: string): string {
  const rawHtml = md.render(src);
  return DOMPurify.sanitize(rawHtml, { USE_PROFILES: { html: true } });
}
