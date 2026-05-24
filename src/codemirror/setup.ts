// src/codemirror/setup.ts — build a CodeMirror EditorView with our defaults.
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";

import { markdownExtensions } from "@/codemirror/markdownExtensions";
import { workstationTheme } from "@/codemirror/theme";

export interface BuildEditorOptions {
  parent: HTMLElement;
  doc: string;
  readOnly?: boolean;
  lineNumbersOn?: boolean;
  onChange?: (doc: string) => void;
}

export function buildEditor(opts: BuildEditorOptions): EditorView {
  const extensions: Extension[] = [
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    ...markdownExtensions(),
    workstationTheme,
    EditorState.readOnly.of(!!opts.readOnly),
  ];
  if (opts.lineNumbersOn) {
    extensions.unshift(lineNumbers());
  }
  if (opts.onChange) {
    extensions.push(
      EditorView.updateListener.of((u) => {
        if (u.docChanged) opts.onChange?.(u.state.doc.toString());
      })
    );
  }
  return new EditorView({
    parent: opts.parent,
    state: EditorState.create({ doc: opts.doc, extensions }),
  });
}
