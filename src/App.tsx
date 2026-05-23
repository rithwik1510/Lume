// Workstation root. Phase 2: horizontal flex layout with the Sidebar on the
// left and the Tiling Area (PaneTree) filling the rest. The Sidebar manages
// its own width via CSS module; the tiling area takes flex: 1.

import { useEffect } from "react";

import { PaneTree } from "@/components/PaneTree";
import { Sidebar } from "@/components/Sidebar";
import { useLayoutStore } from "@/store/layoutStore";
import { installPtyOrchestrator } from "@/terminals/orchestrator";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";

export default function App() {
  const root = useLayoutStore((s) => s.root);

  useEffect(() => {
    const dispose = installPtyOrchestrator();
    const { root: existingRoot, initWithFirstPane } = useLayoutStore.getState();
    if (existingRoot === null) {
      // One pane at launch — user splits via Ctrl+Alt+→/↓/↑.
      // The Weekend 1 4-pane bootstrap was smoothness-baseline scaffolding,
      // not the real product UX.
      initWithFirstPane("pane-1");
    }
    return () => dispose();
  }, []);

  // Wire keyboard shortcuts (W2-P3): split/focus/close.
  useKeyboardShortcuts();

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        background: "var(--bg-0)",
        display: "flex",
        flexDirection: "row",
        boxSizing: "border-box",
      }}
    >
      <Sidebar />
      <div style={{ flex: 1, position: "relative", padding: 1, minWidth: 0 }}>
        {root === null ? (
          <div
            style={{
              color: "var(--fg-2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
            }}
          >
            empty layout
          </div>
        ) : (
          <PaneTree node={root} path="root" />
        )}
      </div>
    </div>
  );
}
