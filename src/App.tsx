// Workstation root. Weekend 1 surface: install the PTY orchestrator and lay
// out four Terminal Panes in a 2×2 grid for the Smoothness Acceptance Test
// (DESIGN.md §9). Tiling tree + splitters + sidebar + MD editor land in
// later weekends. Keeping this dumb on purpose.

import { useEffect } from "react";

import { TerminalPane } from "@/components/TerminalPane";
import { useLayoutStore } from "@/store/layoutStore";
import { installPtyOrchestrator } from "@/terminals/orchestrator";

const INITIAL_PANE_IDS = ["p1", "p2", "p3", "p4"] as const;

export default function App() {
  const paneIds = useLayoutStore((s) => s.paneIds);
  const focusedPaneId = useLayoutStore((s) => s.focusedPaneId);

  useEffect(() => {
    const dispose = installPtyOrchestrator();
    const { addPane, paneIds: existing } = useLayoutStore.getState();
    for (const id of INITIAL_PANE_IDS) {
      if (!existing.includes(id)) addPane(id);
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
