// src/components/MdEditor.tsx
import { useEffect, useRef, useState } from "react";

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

  // Preview pane toggle (DESIGN.md §3 "toggleable via a button in the MD Editor
  // toolbar"). Default open; hiding gives the editor the full width and skips
  // the markdown-it render entirely — useful when the preview feels redundant
  // or when scrolling the source freely without the preview tagging along.
  const [previewOpen, setPreviewOpen] = useState(true);

  const editorHostRef = useRef<HTMLDivElement | null>(null);
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

  // Editor↔preview scroll sync intentionally NOT wired in v0.1. DESIGN.md §3
  // calls it "best-effort"; the percentage-based sync we shipped originally
  // felt disorienting because preview height rarely matches editor height
  // (rendered HTML is much shorter than source markdown). Independent scroll
  // is the v0.1 ergonomic; smarter source-mapped sync is deferred to v0.2.

  return (
    <div className={styles.root}>
      <MdEditorTabStrip />
      <div className={styles.toolbar}>
        <button
          className={`${styles.toggle} ${previewOpen ? styles.toggleActive : ""}`}
          onClick={() => setPreviewOpen((o) => !o)}
          title={previewOpen ? "Hide preview pane" : "Show preview pane"}
          disabled={tab === null}
        >
          {previewOpen ? "Hide Preview" : "Show Preview"}
        </button>
      </div>
      <div className={styles.body}>
        {tab === null ? (
          <div className={styles.empty}>No file open · Ctrl+O to open</div>
        ) : (
          <>
            <div className={styles.editor}>
              <div className={styles.cm} ref={editorHostRef} />
            </div>
            {previewOpen && (
              <div className={styles.preview}>
                <MdEditorPreview source={tab.content} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
