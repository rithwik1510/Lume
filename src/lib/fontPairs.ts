// Font-pair registry — matched UI + monospace families bundled in v0.2.
//
// A pair sets BOTH --font-ui (sidebar, settings, MD body) and --font-mono
// (terminal, code blocks) on :root via the data-font-pair attribute. Picking
// a pair makes the whole app read as one type system even though the terminal
// has to stay monospace.
//
// Concrete font files are imported in src/styles/fonts.css; the per-pair
// --font-* assignments live in src/styles/theme.css under
// :root[data-font-pair="<name>"].

export const FONT_PAIR_NAMES = ["modern", "geist", "plex", "system"] as const;
export type FontPairName = (typeof FONT_PAIR_NAMES)[number];

export const DEFAULT_FONT_PAIR: FontPairName = "modern";

export interface FontPairMeta {
  id: FontPairName;
  label: string;
  description: string;
}

export const FONT_PAIRS: FontPairMeta[] = [
  {
    id: "modern",
    label: "Modern Default",
    description: "Inter + JetBrains Mono",
  },
  {
    id: "geist",
    label: "Geist",
    description: "Geist Sans + Geist Mono",
  },
  {
    id: "plex",
    label: "IBM Plex",
    description: "IBM Plex Sans + IBM Plex Mono",
  },
  {
    id: "system",
    label: "System (Apple / Windows)",
    description: "SF Pro + SF Mono on Mac, Segoe UI + Cascadia on Windows",
  },
];

/** Narrow an arbitrary string (from config.toml) to a known pair name.
 *  Unknown values fall back to DEFAULT_FONT_PAIR so a stale config never
 *  black-screens the app. */
export function coerceFontPair(value: string | null | undefined): FontPairName {
  if (value && (FONT_PAIR_NAMES as readonly string[]).includes(value)) {
    return value as FontPairName;
  }
  return DEFAULT_FONT_PAIR;
}

/** Read the active --font-mono stack off :root after a pair switch. xterm
 *  takes the resolved stack as its fontFamily option. */
export function currentMonoFamily(): string {
  return (
    getComputedStyle(document.documentElement)
      .getPropertyValue("--font-mono")
      .trim() || "JetBrains Mono Variable, Consolas, monospace"
  );
}
