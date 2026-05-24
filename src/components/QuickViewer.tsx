// src/components/QuickViewer.tsx
import { useEffect, useRef } from "react";

import styles from "@/components/QuickViewer.module.css";
import { buildEditor } from "@/codemirror/setup";
import { useMdStore } from "@/store/mdStore";
import type { EditorView } from "@codemirror/view";

export function QuickViewer() {
  const path = useMdStore((s) => s.quickViewer.path);
  const content = useMdStore((s) => s.quickViewer.content);
  const dirty = useMdStore((s) => s.quickViewer.dirty);
  const setContent = useMdStore((s) => s.setQuickViewerContent);
  const save = useMdStore((s) => s.saveQuickViewer);
  const close = useMdStore((s) => s.closeQuickViewer);

  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);

  // Build the editor once per Quick Viewer open. When `path` changes, dispose
  // and rebuild — simplest correct path; CM doesn't need to be reused across
  // files.
  useEffect(() => {
    if (!hostRef.current || path === null) return;
    const view = buildEditor({
      parent: hostRef.current,
      doc: content,
      onChange: (doc) => setContent(doc),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]); // intentionally not depending on content — store updates don't rebuild

  // Ctrl+S to save when QuickViewer has focus.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && (e.key === "s" || e.key === "S")) {
        const active = document.activeElement;
        if (hostRef.current && active && hostRef.current.contains(active)) {
          e.preventDefault();
          void save();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [save]);

  if (path === null) return null;
  const fileName = path.split(/[/\\]/).pop() ?? path;

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <span className={styles.title}>
          {dirty && <span className={styles.dirty}>●</span>}
          {fileName}
        </span>
        <button className={styles.close} title="Close" onClick={close}>
          ✕
        </button>
      </div>
      <div className={styles.editor} ref={hostRef} />
    </div>
  );
}
