// src/lib/paneHitTest.ts
//
// Find the terminal pane under a screen point. Both the internal pointer-drag
// (file row → pane) and the external Tauri OS drop hit-test this way against the
// `data-pane-id` the TerminalPane wrapper sets. Coordinates are CSS pixels
// (clientX/clientY); the Tauri path divides physical coords by devicePixelRatio
// before calling.

import type { PaneId } from "@/types";

export function paneIdAtClientPoint(x: number, y: number): PaneId | null {
  const el = document.elementFromPoint(x, y);
  const host = (el?.closest("[data-pane-id]") as HTMLElement | null) ?? null;
  return (host?.dataset.paneId as PaneId | undefined) ?? null;
}
