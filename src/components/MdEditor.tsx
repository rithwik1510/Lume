// src/components/MdEditor.tsx
//
// Single-pane MD Editor Full View (DESIGN.md §3, CONTEXT.md "MD Editor"):
// every open tab shows EITHER the rendered HTML view (markdown-it + DOMPurify,
// default) OR the CodeMirror source editor. A pen icon in the top-right
// toolbar toggles between them. Tab switches reset the mode to view.
//
// The earlier side-by-side editor+preview layout (Phase 6) was replaced after
// the rendered-HTML height never matched the source height — percentage-based
// scroll sync was disorienting and the duplicated content read as two files
// instead of one document. The single-pane toggle is the Obsidian / Bear /
// "Reading view vs Edit view" pattern.

import { useEffect, useRef, useState } from "react";

import styles from "@/components/MdEditor.module.css";
import { buildEditor } from "@/codemirror/setup";
import { MdEditorPreview } from "@/components/MdEditorPreview";
import { MdEditorTabStrip } from "@/components/MdEditorTabStrip";
import { useMdStore } from "@/store/mdStore";
import type { EditorView } from "@codemirror/view";

type Mode = "view" | "edit";

export function MdEditor() {
  const activeTabId = useMdStore((s) => s.activeTabId);
  const tab = useMdStore((s) => s.tabs.find((t) => t.id === activeTabId) ?? null);
  const setTabContent = useMdStore((s) => s.setTabContent);

  // Per-tab mode, reset to "view" whenever the active tab changes (CONTEXT.md
  // "Tab switches reset the mode to view"). Held locally — there's no need to
  // persist mode across app restarts; opening a file is "I want to read it".
  const [mode, setMode] = useState<Mode>("view");
  useEffect(() => {
    setMode("view");
  }, [tab?.id]);

  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);

  // Build the CodeMirror EditorView when entering edit mode; destroy when
  // leaving. Doc is seeded from the store's current tab.content, and edits
  // flow back via setTabContent so view mode reflects the latest text.
  useEffect(() => {
    if (mode !== "edit" || !editorHostRef.current || tab === null) return;
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
    // Tab identity + mode are the only triggers; depending on `tab.content`
    // would rebuild the editor on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab?.id, mode]);

  const togglePen = () => setMode((m) => (m === "view" ? "edit" : "view"));
  const penLabel = mode === "edit" ? "Switch to view mode" : "Edit (Ctrl+E twice or click)";

  return (
    <div className={styles.root}>
      <MdEditorTabStrip />
      <div className={styles.toolbar}>
        <button
          className={`${styles.penButton} ${mode === "edit" ? styles.penActive : ""}`}
          onClick={togglePen}
          title={penLabel}
          aria-label={penLabel}
          aria-pressed={mode === "edit"}
          disabled={tab === null}
        >
          {/* Pen glyph — outlined when in view mode, amber/filled when in edit. */}
          ✎
        </button>
      </div>
      <div className={styles.body}>
        {tab === null ? (
          <div className={styles.empty}>No file open · Ctrl+O to open</div>
        ) : mode === "edit" ? (
          <div className={styles.editor}>
            <div className={styles.cm} ref={editorHostRef} />
          </div>
        ) : (
          <div className={styles.view}>
            <MdEditorPreview source={tab.content} />
          </div>
        )}
      </div>
    </div>
  );
}
