// Workstation root. Phase 2: horizontal flex layout with the Sidebar on the
// left and the Tiling Area (PaneTree) filling the rest. The Sidebar manages
// its own width via CSS module; the tiling area takes flex: 1.
//
// Phase 4: the tiling area is itself a horizontal PanelGroup so the MD Quick
// Viewer can dock on the right (default 25%, min 20%, max 60%) when open.

import { useEffect } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";

import { ContextMenu } from "@/components/ContextMenu";
import { PaneTree } from "@/components/PaneTree";
import { QuickViewer } from "@/components/QuickViewer";
import { Sidebar } from "@/components/Sidebar";
import { useLayoutStore } from "@/store/layoutStore";
import { useMdStore } from "@/store/mdStore";
import { installPtyOrchestrator } from "@/terminals/orchestrator";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";

export default function App() {
  const root = useLayoutStore((s) => s.root);
  const quickViewerOpen = useMdStore((s) => s.quickViewer.open);

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
      <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
        <PanelGroup direction="horizontal" id="pg-root-h">
          <Panel defaultSize={quickViewerOpen ? 75 : 100} minSize={40}>
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
          </Panel>
          {quickViewerOpen && (
            <>
              <PanelResizeHandle
                style={{ width: 3, background: "var(--border)", cursor: "col-resize" }}
              />
              <Panel defaultSize={25} minSize={20} maxSize={60}>
                <QuickViewer />
              </Panel>
            </>
          )}
        </PanelGroup>
      </div>
      <ContextMenu />
    </div>
  );
}
