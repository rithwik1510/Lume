// src/codemirror/markdownExtensions.ts
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";

export const markdownExtensions = () => [
  markdown({
    base: markdownLanguage,
    codeLanguages: languages,
  }),
];
