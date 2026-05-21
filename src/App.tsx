// Workstation root. Weekend 2: render the layoutStore tree via PaneTree (nested
// react-resizable-panels). Bootstrap 4 panes on first mount so the smoothness
// baseline is comparable to the Weekend 1 setup, but now through real splits.

import { useEffect } from "react";

import { PaneTree } from "@/components/PaneTree";
import { useLayoutStore } from "@/store/layoutStore";
import { installPtyOrchestrator } from "@/terminals/orchestrator";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";

export default function App() {
  const root = useLayoutStore((s) => s.root);

  useEffect(() => {
    const dispose = installPtyOrchestrator();
    const { root: existingRoot, initWithFirstPane, splitPane } = useLayoutStore.getState();
    if (existingRoot === null) {
      // Build a 2×2 visual: split right, then split each column down.
      initWithFirstPane("pane-1");
      splitPane("right", "pane-2", "pane-1");
      splitPane("down", "pane-3", "pane-1");
      splitPane("down", "pane-4", "pane-2");
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
        background: "#0a0a0a",
        padding: 1,
        boxSizing: "border-box",
      }}
    >
      {root === null ? (
        <div
          style={{
            color: "#555",
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
  );
}
