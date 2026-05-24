// src/components/MdEditor.tsx
import { useEffect, useRef } from "react";

import styles from "@/components/MdEditor.module.css";
import { buildEditor } from "@/codemirror/setup";
import { MdEditorPreview } from "@/components/MdEditorPreview";
import { MdEditorTabStrip } from "@/components/MdEditorTabStrip";
import { useMdStore } from "@/store/mdStore";
import type { EditorView } from "@codemirror/view";

export function MdEditor() {
  const activeTabId = useMdStore((s) => s.activeTabId);
  const tab = useMdStore((s) => s.tabs.find((t) => t.id === activeTabId) ?? null);
  const setTabContent = useMdStore((s) => s.setTabContent);

  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const previewScrollRef = useRef<HTMLDivElement | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);

  // Build / rebuild editor when active tab changes. Intentionally NOT depending
  // on `tab.content` — once the EditorView is built it owns its own doc state
  // via the onChange callback into setTabContent; reacting to `content` here
  // would tear down and rebuild on every keystroke.
  useEffect(() => {
    if (!editorHostRef.current || tab === null) return;
    const view = buildEditor({
      parent: editorHostRef.current,
      doc: tab.content,
      lineNumbersOn: true,
      onChange: (doc) => setTabContent(tab.id, doc),
    });
    editorViewRef.current = view;
    return () => {
      view.destroy();
      editorViewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab?.id]);

  // Scroll sync: editor → preview via percentage. rAF-coalesced.
  useEffect(() => {
    const view = editorViewRef.current;
    if (!view || !previewScrollRef.current) return;
    let raf: number | null = null;
    const handler = () => {
      if (raf !== null) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        const scroller = view.scrollDOM;
        const previewEl = previewScrollRef.current;
        if (!previewEl) return;
        const pct = scroller.scrollTop / Math.max(1, scroller.scrollHeight - scroller.clientHeight);
        previewEl.scrollTop = pct * Math.max(0, previewEl.scrollHeight - previewEl.clientHeight);
      });
    };
    view.scrollDOM.addEventListener("scroll", handler, { passive: true });
    return () => {
      view.scrollDOM.removeEventListener("scroll", handler);
      if (raf !== null) cancelAnimationFrame(raf);
    };
  }, [tab?.id]);

  return (
    <div className={styles.root}>
      <MdEditorTabStrip />
      <div className={styles.body}>
        {tab === null ? (
          <div className={styles.empty}>No file open · Ctrl+O to open</div>
        ) : (
          <>
            <div className={styles.editor}>
              <div className={styles.cm} ref={editorHostRef} />
            </div>
            <div className={styles.preview}>
              <MdEditorPreview source={tab.content} containerRef={previewScrollRef} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
