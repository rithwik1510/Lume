// src/components/MdEditorPreview.tsx
import { useEffect, useMemo, useRef, useState } from "react";

import styles from "@/components/MdEditorPreview.module.css";
import { renderMarkdown } from "@/preview/renderMarkdown";

interface Props {
  source: string;
}

export function MdEditorPreview({ source }: Props) {
  // Initial render is deferred via setTimeout(0) so the tab can paint
  // (showing the preview pane briefly empty) BEFORE the synchronous
  // markdown-it + DOMPurify pass runs. On a large doc that pass can stall
  // for hundreds of ms — without the defer the user sees "(not responding)"
  // until React commits the first render. Subsequent edits still go through
  // the 250 ms debounce (DESIGN.md §4 rule).
  const [renderedSrc, setRenderedSrc] = useState<string>("");
  const firstRenderRef = useRef(true);
  useEffect(() => {
    const delay = firstRenderRef.current ? 0 : 250;
    firstRenderRef.current = false;
    const t = window.setTimeout(() => setRenderedSrc(source), delay);
    return () => window.clearTimeout(t);
  }, [source]);
  const html = useMemo(() => renderMarkdown(renderedSrc), [renderedSrc]);
  return (
    <div className={styles.root}>
      <div className={styles.inner} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
