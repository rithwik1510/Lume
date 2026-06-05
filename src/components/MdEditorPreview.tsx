// src/components/MdEditorPreview.tsx
import { useEffect, useMemo, useState } from "react";

import styles from "@/components/MdEditorPreview.module.css";
import { renderMarkdown } from "@/preview/renderMarkdown";
import { openExternal } from "@/lib/openExternal";

interface Props {
  source: string;
}

export function MdEditorPreview({ source }: Props) {
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
    if (href && /^https?:\/\//i.test(href)) {
      e.preventDefault();
      void openExternal(href).catch(() => undefined);
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
