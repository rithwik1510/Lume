// Workstation root. Weekend 2 W2-P1 bridge: the layoutStore is now binary-tree
// based, but the actual render-via-splitters UI lands in W2-P2. For now we
// keep rendering panes in a flat grid driven by `leaves(root)` so the existing
// 4-pane smoothness baseline still works while we land the tree underneath.

import { useEffect } from "react";

import { TerminalPane } from "@/components/TerminalPane";
import { useLayoutStore, getPaneIds } from "@/store/layoutStore";
import { installPtyOrchestrator } from "@/terminals/orchestrator";

const INITIAL_PANE_IDS = ["p1", "p2", "p3", "p4"] as const;

export default function App() {
  const paneIds = useLayoutStore(getPaneIds);
  const focusedPaneId = useLayoutStore((s) => s.focusedPaneId);

  useEffect(() => {
    const dispose = installPtyOrchestrator();
    const { root, initWithFirstPane, splitPane } = useLayoutStore.getState();
    if (root === null) {
      // First pane bootstraps the tree as a single leaf.
      const [first, ...rest] = INITIAL_PANE_IDS;
      if (first === undefined) return;
      initWithFirstPane(first);
      // Subsequent panes split the focused pane to the right. For a 2x2 visual
      // we'd alternate right / down — W2-P2 will replace this with a proper
      // initial layout. For now the flat-grid render below is independent of
      // the tree's actual shape.
      for (const id of rest) splitPane("right", id);
    }
    return () => dispose();
  }, []);

  return (
    <div
      style={{
        width: "100vw",
        height: "100vh",
        background: "#0a0a0a",
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gridTemplateRows: "1fr 1fr",
        gap: 1,
        padding: 1,
        boxSizing: "border-box",
      }}
    >
      {paneIds.map((id) => (
        <div
          key={id}
          style={{
            position: "relative",
            border:
              focusedPaneId === id ? "1px solid #d4a85c" : "1px solid #181818",
            background: "#0a0a0a",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              top: 4,
              right: 8,
              fontSize: 10,
              color: focusedPaneId === id ? "#d4a85c" : "#555",
              fontFamily: "Inter, sans-serif",
              userSelect: "none",
              pointerEvents: "none",
              zIndex: 1,
            }}
          >
            {id}
          </div>
          <TerminalPane paneId={id} />
        </div>
      ))}
    </div>
  );
}
