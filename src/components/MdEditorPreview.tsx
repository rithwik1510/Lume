// src/components/MdEditorPreview.tsx
import { useEffect, useMemo, useRef, useState } from "react";

import styles from "@/components/MdEditorPreview.module.css";
import { renderMarkdown } from "@/preview/renderMarkdown";

interface Props {
  source: string;
  /** Imperative ref to the inner scroll container, exposed for scroll-sync. */
  containerRef?: React.MutableRefObject<HTMLDivElement | null>;
}

export function MdEditorPreview({ source, containerRef }: Props) {
  // Debounce the render to ~250ms after the last edit (DESIGN.md §4 rule).
  const [renderedSrc, setRenderedSrc] = useState(source);
  useEffect(() => {
    const t = window.setTimeout(() => setRenderedSrc(source), 250);
    return () => window.clearTimeout(t);
  }, [source]);
  const html = useMemo(() => renderMarkdown(renderedSrc), [renderedSrc]);
  const innerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (containerRef) containerRef.current = innerRef.current;
  });
  return <div className={styles.root} ref={innerRef} dangerouslySetInnerHTML={{ __html: html }} />;
}
