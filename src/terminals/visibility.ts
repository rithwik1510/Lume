// The authoritative set of currently-visible panes — the single source of
// truth that decouples the render governor (policy) from the render sink and
// WebGL pool (mechanism). A pane is "visible" iff it belongs to the foreground
// session or a split-view member (see getVisiblePaneIds in sessionsStore).
//
// FAIL-SAFE: when the set is EMPTY, shouldRenderLive() returns true for every
// pane. So if the governor is never installed, hasn't seeded yet, or breaks,
// the renderer falls back to "render everything live" — i.e. exactly today's
// behavior. The output-suspension optimization only ever engages once the
// governor has demonstrably populated the set. Nothing the governor does can
// blank a foreground terminal.

import type { PaneId } from "@/types";

let visiblePanes = new Set<PaneId>();

/** Strict membership — used by the WebGL pool to decide who gets a context. */
export function isVisible(paneId: PaneId): boolean {
  return visiblePanes.has(paneId);
}

/** Render-routing predicate with the empty-set fail-safe (see file header). */
export function shouldRenderLive(paneId: PaneId): boolean {
  return visiblePanes.size === 0 || visiblePanes.has(paneId);
}

export function getVisiblePanes(): ReadonlySet<PaneId> {
  return visiblePanes;
}

/** Replace the visible set; returns which panes entered/exited visibility so
 *  the governor can drive the corresponding transitions. */
export function setVisiblePanes(next: Set<PaneId>): {
  entered: PaneId[];
  exited: PaneId[];
} {
  const entered: PaneId[] = [];
  const exited: PaneId[] = [];
  for (const id of next) if (!visiblePanes.has(id)) entered.push(id);
  for (const id of visiblePanes) if (!next.has(id)) exited.push(id);
  visiblePanes = next;
  return { entered, exited };
}

/** Test/HMR reset. */
export function __resetVisibility(): void {
  visiblePanes = new Set();
}
