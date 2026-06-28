// src/components/MdEditorPreview.tsx
import { useEffect, useMemo, useState } from "react";

import styles from "@/components/MdEditorPreview.module.css";
import { renderMarkdown } from "@/preview/renderMarkdown";
import { openExternal } from "@/lib/openExternal";
import { useMdStore } from "@/store/mdStore";
import { useToastStore } from "@/store/toastStore";

interface Props {
  source: string;
  filePath?: string | null;
}

function isAbsolutePath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("/") || path.startsWith("\\\\");
}

function dirname(path: string): string {
  const idx = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return idx === -1 ? "" : path.slice(0, idx);
}

function decodeHrefPath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

function resolveMarkdownHref(href: string, filePath: string | null | undefined): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return null;
  const pathPart = href.split("#", 1)[0].split("?", 1)[0];
  if (!/\.mdx?$/i.test(pathPart)) return null;
  const decoded = decodeHrefPath(pathPart);
  if (isAbsolutePath(decoded)) return decoded;
  if (!filePath) return null;
  const base = dirname(filePath);
  if (!base) return decoded;
  const sep = base.includes("\\") ? "\\" : "/";
  return `${base}${base.endsWith("/") || base.endsWith("\\") ? "" : sep}${decoded}`;
}

function scrollToHeading(container: HTMLElement, href: string): boolean {
  if (!href.startsWith("#") || href.length === 1) return false;
  const targetId = decodeHrefPath(href.slice(1));
  const target = Array.from(container.querySelectorAll<HTMLElement>("[id]")).find(
    (node) => node.id === targetId
  );
  target?.scrollIntoView({ block: "start", behavior: "smooth" });
  return target !== undefined;
}

export function MdEditorPreview({ source, filePath = null }: Props) {
  const openMdTab = useMdStore((s) => s.openMdTab);

  // The markdown-it + DOMPurify pass is deferred one tick (setTimeout 0) so
  // the pane paints first — on a large doc the pass can stall for hundreds of
  // ms, and without the defer the user sees "(not responding)" until React
  // commits. The defer applies to opens AND tab switches alike; there is NO
  // extra debounce, so switching between files renders as fast as the parse
  // allows (the previous content stays on screen until the new parse lands —
  // no blank flash). A debounce only makes sense for live keystroke previews,
  // which this single-pane editor doesn't have (edit happens in CodeMirror).
  const [renderedSrc, setRenderedSrc] = useState<string>("");
  useEffect(() => {
    const t = window.setTimeout(() => setRenderedSrc(source), 0);
    return () => window.clearTimeout(t);
  }, [source]);
  const html = useMemo(() => renderMarkdown(renderedSrc), [renderedSrc]);

  // Intercept anchor clicks so http(s) links open in the real browser rather
  // than navigating the Tauri webview away. target=_blank alone is not enough
  // inside a webview — the browser tab that would open IS the webview.
  const onPreviewClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const anchor = (e.target as HTMLElement | null)?.closest?.("a");
    const href = anchor?.getAttribute("href");
    if (!href) return;
    if (href.startsWith("#") && scrollToHeading(e.currentTarget, href)) {
      e.preventDefault();
      return;
    }
    if (/^https?:\/\//i.test(href)) {
      e.preventDefault();
      void openExternal(href).catch(() => undefined);
      return;
    }
    const mdPath = resolveMarkdownHref(href, filePath);
    if (mdPath) {
      e.preventDefault();
      void openMdTab(mdPath).catch((err) => {
        useToastStore.getState().push({
          severity: "error",
          message: `Open failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      });
    }
  };

  return (
    <div className={styles.root}>
      <div
        className={styles.inner}
        dangerouslySetInnerHTML={{ __html: html }}
        onClick={onPreviewClick}
      />
    </div>
  );
}
