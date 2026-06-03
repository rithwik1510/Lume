// src/codemirror/theme.ts — minimal dark theme keyed on our CSS tokens.
import { EditorView } from "@codemirror/view";

export const lumeTheme = EditorView.theme(
  {
    "&": {
      backgroundColor: "var(--bg-0)",
      color: "var(--fg-0)",
      height: "100%",
    },
    ".cm-content": {
      caretColor: "var(--accent)",
      fontFamily: "var(--font-ui)",
      fontSize: "15px",
      lineHeight: "1.6",
      padding: "12px 16px",
    },
    ".cm-content[contenteditable='true']": {
      outline: "none",
    },
    ".cm-line": {
      padding: "0",
    },
    ".cm-cursor": {
      borderLeftColor: "var(--accent)",
      borderLeftWidth: "2px",
    },
    "&.cm-focused .cm-selectionBackground, ::selection": {
      backgroundColor: "var(--accent-alpha)",
    },
    ".cm-gutters": {
      backgroundColor: "var(--bg-0)",
      color: "var(--fg-2)",
      border: "none",
      fontFamily: "var(--font-mono)",
      fontSize: "12px",
    },
    ".cm-activeLineGutter, .cm-activeLine": {
      backgroundColor: "var(--bg-1)",
    },
    ".cm-scroller": {
      overflow: "auto",
    },
    // Fenced code blocks render in mono via the markdown language config below.
  },
  { dark: true }
);
