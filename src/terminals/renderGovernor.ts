// Render governor — the policy layer that drives the WebGL pool and the render
// sink from session visibility. Installed once at app boot (App.tsx), next to
// the PTY orchestrator.
//
// On any sessions-store change it recomputes the visible-pane set (foreground
// session + split-view members) and applies the transitions:
//   - exited visibility → mark its WebGL evictable (kept warm until cap pressure)
//   - entered visibility → acquire WebGL + replay any buffered output, then go live
//
// The whole apply() runs synchronously inside the store subscriber, so it is
// atomic with respect to PTY channel callbacks (JS is single-threaded): a
// foregrounded pane's buffered replay always lands before its next live chunk.

import { useSessionsStore, getVisiblePaneIds } from "@/store/sessionsStore";
import { setVisiblePanes } from "@/terminals/visibility";
import { acquireRenderer, markBackgroundRenderer } from "@/terminals/registry";
import { foreground } from "@/terminals/renderSink";

export function installRenderGovernor(): () => void {
  const apply = (): void => {
    const next = new Set(getVisiblePaneIds(useSessionsStore.getState()));
    const { entered, exited } = setVisiblePanes(next);
    if (entered.length === 0 && exited.length === 0) return;
    // Mark exits evictable first, so an entering pane's acquire can reclaim a
    // freed context if we're at the WebGL cap.
    for (const id of exited) markBackgroundRenderer(id);
    for (const id of entered) {
      acquireRenderer(id);
      foreground(id);
    }
  };

  apply(); // seed initial visibility (no-op until a session is active)
  return useSessionsStore.subscribe(apply);
}
