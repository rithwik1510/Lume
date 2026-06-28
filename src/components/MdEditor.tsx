// src/components/MdEditor.tsx
//
// Single-pane MD Editor Full View (DESIGN.md §3, CONTEXT.md "MD Editor"):
// every open tab shows EITHER the rendered HTML view (markdown-it + DOMPurify,
// default) OR the CodeMirror source editor. A floating pen icon in the
// top-right of the body toggles between them. Tab switches reset to view.
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
import { IconFolderOpen, IconSave } from "@/components/icons";
import { pickMdFile } from "@/lib/dialogClient";
import { useMdStore } from "@/store/mdStore";
import { useToastStore } from "@/store/toastStore";
import { EditorSelection } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

type Mode = "view" | "edit";

interface EditorMemory {
  anchor: number;
  head: number;
  scrollTop: number;
  scrollLeft: number;
}

/** Pencil glyph. Lucide-style 2-path edit icon (page + tip). currentColor
 *  inherits from the button, so the SVG follows our view/edit accent states. */
function PenIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}

export function MdEditor() {
  const activeTabId = useMdStore((s) => s.activeTabId);
  const tab = useMdStore((s) => s.tabs.find((t) => t.id === activeTabId) ?? null);
  const setTabContent = useMdStore((s) => s.setTabContent);
  const openMdTab = useMdStore((s) => s.openMdTab);
  const saveMdTab = useMdStore((s) => s.saveMdTab);

  // Open a file through the native OS picker (filtered to Markdown) — the
  // intuitive alternative to typing an absolute path into Ctrl+O.
  const openFileViaPicker = async () => {
    try {
      const path = await pickMdFile();
      if (path) await openMdTab(path);
    } catch (err) {
      useToastStore.getState().push({
        severity: "error",
        message: `Couldn't open file: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  const [mode, setMode] = useState<Mode>("view");
  useEffect(() => {
    // Report focus surface for the Status Bar (DESIGN.md §3, CONTEXT.md
    // "Status Bar"). Mounting MdEditor implies the user is reading it.
    useMdStore.getState().setFocusedSurface("md-editor");
  }, [tab?.id]);

  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const editorMemoryRef = useRef(new Map<string, EditorMemory>());

  // Build the CodeMirror EditorView when entering edit mode; destroy when
  // leaving. Doc is seeded from the store's current tab.content, and edits
  // flow back via setTabContent so view mode reflects the latest text.
  useEffect(() => {
    if (mode !== "edit" || !editorHostRef.current || tab === null) return;
    const memory = editorMemoryRef.current.get(tab.id);
    const docLen = tab.content.length;
    const view = buildEditor({
      parent: editorHostRef.current,
      doc: tab.content,
      lineNumbersOn: true,
      selection: memory
        ? EditorSelection.single(
            Math.min(memory.anchor, docLen),
            Math.min(memory.head, docLen)
          )
        : undefined,
      onChange: (doc) => setTabContent(tab.id, doc),
    });
    editorViewRef.current = view;
    const raf = window.requestAnimationFrame(() => {
      if (!memory) return;
      view.scrollDOM.scrollTop = memory.scrollTop;
      view.scrollDOM.scrollLeft = memory.scrollLeft;
    });
    return () => {
      window.cancelAnimationFrame(raf);
      const main = view.state.selection.main;
      editorMemoryRef.current.set(tab.id, {
        anchor: main.anchor,
        head: main.head,
        scrollTop: view.scrollDOM.scrollTop,
        scrollLeft: view.scrollDOM.scrollLeft,
      });
      view.destroy();
      editorViewRef.current = null;
    };
    // Tab identity + mode are the only triggers; depending on `tab.content`
    // would rebuild the editor on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab?.id, mode]);

  const togglePen = () => setMode((m) => (m === "view" ? "edit" : "view"));
  const penLabel = mode === "edit" ? "Switch to view mode" : "Switch to edit mode";

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <MdEditorTabStrip />
        <button
          className={styles.penButton}
          onClick={() => void openFileViaPicker()}
          title="Open Markdown file… (Ctrl+O)"
          aria-label="Open Markdown file"
        >
          <IconFolderOpen size={18} />
        </button>
        {tab !== null && (
          <button
            className={styles.penButton}
            onClick={() => void saveMdTab(tab.id)}
            title="Save"
            aria-label="Save"
            disabled={!tab.dirty}
          >
            <IconSave size={16} />
          </button>
        )}
        {tab !== null && (
          <button
            className={`${styles.penButton} ${mode === "edit" ? styles.penActive : ""}`}
            onClick={togglePen}
            title={penLabel}
            aria-label={penLabel}
            aria-pressed={mode === "edit"}
          >
            <PenIcon />
          </button>
        )}
      </div>
      <div className={styles.body}>
        {tab === null ? (
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>No file open</p>
            <button className={styles.openBtn} onClick={() => void openFileViaPicker()}>
              <IconFolderOpen size={16} />
              <span>Open a Markdown file…</span>
            </button>
            <p className={styles.emptyHint}>or press Ctrl+O</p>
          </div>
        ) : mode === "edit" ? (
          <div className={styles.editor}>
            <div className={styles.cm} ref={editorHostRef} />
          </div>
        ) : (
          <div className={styles.view}>
            <MdEditorPreview source={tab.content} filePath={tab.path} />
          </div>
        )}
      </div>
    </div>
  );
}
