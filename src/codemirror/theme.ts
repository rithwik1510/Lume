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
      padding: "16px 20px 32px",
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
      borderRight: "1px solid var(--border)",
      fontFamily: "var(--font-mono)",
      fontSize: "12px",
    },
    ".cm-lineNumbers .cm-gutterElement": {
      padding: "0 10px 0 12px",
    },
    ".cm-foldGutter .cm-gutterElement": {
      color: "var(--fg-3)",
      padding: "0 8px 0 4px",
    },
    ".cm-activeLineGutter, .cm-activeLine": {
      backgroundColor: "var(--bg-1)",
    },
    ".cm-scroller": {
      overflow: "auto",
    },
    ".cm-matchingBracket, .cm-nonmatchingBracket": {
      backgroundColor: "var(--accent-alpha)",
      outline: "1px solid var(--accent-dim)",
    },
    ".cm-panels": {
      backgroundColor: "var(--bg-1)",
      color: "var(--fg-0)",
      borderBottom: "1px solid var(--border)",
      fontFamily: "var(--font-ui)",
    },
    ".cm-panels.cm-panels-top": {
      borderBottom: "1px solid var(--border)",
    },
    ".cm-search": {
      display: "flex",
      alignItems: "center",
      gap: "8px",
      padding: "8px 10px",
    },
    ".cm-search input": {
      backgroundColor: "var(--bg-0)",
      color: "var(--fg-0)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-sm)",
      padding: "4px 8px",
      fontFamily: "var(--font-ui)",
      fontSize: "12px",
    },
    ".cm-search button": {
      backgroundColor: "var(--bg-2)",
      color: "var(--fg-1)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius-sm)",
      padding: "4px 8px",
      fontFamily: "var(--font-ui)",
      fontSize: "12px",
      cursor: "pointer",
    },
    ".cm-search button:hover": {
      backgroundColor: "var(--bg-3)",
      color: "var(--fg-0)",
    },
    ".cm-search label": {
      color: "var(--fg-2)",
      fontSize: "12px",
    },
    ".cm-searchMatch": {
      backgroundColor: "rgba(212, 168, 92, 0.28)",
    },
    ".cm-searchMatch-selected": {
      backgroundColor: "rgba(212, 168, 92, 0.48)",
      outline: "1px solid var(--accent)",
    },
    // Fenced code blocks render in mono via the markdown language config below.
  },
  { dark: true }
);
