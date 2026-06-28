// src/preview/renderMarkdown.ts
// DESIGN.md §4: markdown-it locked to { html: false, linkify: true, breaks: true }
// because the Preview Pane renders inside the Tauri webview which has Tauri
// command access — embedded HTML would be an XSS vector. DOMPurify runs as
// defence-in-depth before injection.

import MarkdownIt from "markdown-it";
import DOMPurify from "dompurify";

const md = new MarkdownIt({ html: false, linkify: true, breaks: true });

interface MarkdownEnv {
  slugs?: Map<string, number>;
}

function slugifyHeading(text: string, env: MarkdownEnv): string {
  const base =
    text
      .trim()
      .toLowerCase()
      .replace(/[`~!@#$%^&*()+=[\]{};:'"\\|,.<>/?]/g, "")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "") || "section";
  const slugs = (env.slugs ??= new Map<string, number>());
  const count = slugs.get(base) ?? 0;
  slugs.set(base, count + 1);
  return count === 0 ? base : `${base}-${count + 1}`;
}

md.renderer.rules.heading_open = (tokens, idx, options, env: MarkdownEnv, self) => {
  const title = tokens[idx + 1]?.content ?? "";
  tokens[idx].attrSet("id", slugifyHeading(title, env));
  return self.renderToken(tokens, idx, options);
};

function enhanceTaskLists(html: string): string {
  return html.replace(/<li>\[([ xX])\]\s+/g, (_match, mark: string) => {
    const checked = mark.toLowerCase() === "x" ? " checked" : "";
    return `<li class="task-list-item"><input class="task-list-item-checkbox" type="checkbox" disabled${checked}> `;
  });
}

const CALLOUT_LABELS: Record<string, string> = {
  note: "Note",
  tip: "Tip",
  important: "Important",
  warning: "Warning",
  caution: "Caution",
};

function enhanceCallouts(html: string): string {
  return html.replace(
    /<blockquote>\s*<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*(?:<br>\s*)?/gi,
    (_match, kind: string) => {
      const key = kind.toLowerCase();
      return `<blockquote class="callout callout-${key}"><p><strong class="callout-title">${CALLOUT_LABELS[key]}</strong><br>`;
    }
  );
}

// Harden all anchors produced by markdown-it / linkify: force them to open in
// a new tab and strip the opener reference so the linked page cannot navigate
// the Tauri webview away (reverse-tabnapping). Registered once at module level.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    const href = node.getAttribute("href") ?? "";
    if (/^https?:\/\//i.test(href)) {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    } else {
      node.removeAttribute("target");
      node.removeAttribute("rel");
    }
  }
});

export function renderMarkdown(src: string): string {
  const rawHtml = enhanceCallouts(enhanceTaskLists(md.render(src, { slugs: new Map() })));
  return DOMPurify.sanitize(rawHtml, { USE_PROFILES: { html: true } });
}
