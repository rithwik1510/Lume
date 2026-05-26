// Workstation root. Phase 2: horizontal flex layout with the Sidebar on the
// left and the Tiling Area (PaneTree) filling the rest. The Sidebar manages
// its own width via CSS module; the tiling area takes flex: 1.
//
// Phase 4: the tiling area is itself a horizontal PanelGroup so the MD Quick
// Viewer can dock on the right (default 25%, min 20%, max 60%) when open.
//
// Phase 6: when MD Editor mode is "full", the entire central area (Tiling Area
// + MD Quick Viewer PanelGroup) is replaced by the <MdEditor /> per CONTEXT.md:
// "When the MD Editor is in Full View, the Tiling Area + MD Quick Viewer area
// are replaced by a single full-width CodeMirror 6 editor with the open MD
// Tabs across the top. The Sidebar remains visible." The Sidebar and the
// ContextMenu portal stay mounted alongside.

import { useEffect } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";

import { ContextMenu } from "@/components/ContextMenu";
import { MdEditor } from "@/components/MdEditor";
import { PaneTree } from "@/components/PaneTree";
import { QuickViewer } from "@/components/QuickViewer";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/TopBar";
import { beginResize, endResize } from "@/components/resizeBus";
import { useLayoutStore } from "@/store/layoutStore";
import { useMdStore } from "@/store/mdStore";
import { useSidebarStore } from "@/store/sidebarStore";
import { installPtyOrchestrator } from "@/terminals/orchestrator";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";

export default function App() {
  const root = useLayoutStore((s) => s.root);
  const quickViewerOpen = useMdStore((s) => s.quickViewer.open);
  const mdMode = useMdStore((s) => s.mdEditorMode);
  const sidebarVisible = useSidebarStore((s) => s.sidebarVisible);

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
        flexDirection: "column",
        boxSizing: "border-box",
      }}
    >
      <TopBar />
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: "flex",
          flexDirection: "row",
        }}
      >
        {sidebarVisible && <Sidebar />}
        <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
          {mdMode === "full" ? (
            <MdEditor />
          ) : (
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
                    // Mirror PaneTree's splitter: gate xterm fit() during the drag
                    // through resizeBus so the WebGL canvas-clear flicker doesn't
                    // hit Terminal Panes inside the left Panel while this handle
                    // is being dragged. Without this hook, every drag tick would
                    // schedule a term.fit() per pane, clearing the framebuffer.
                    onDragging={(isDragging) => {
                      if (isDragging) beginResize();
                      else endResize();
                    }}
                    style={{ width: 3, background: "var(--border)", cursor: "col-resize" }}
                  />
                  <Panel defaultSize={25} minSize={20} maxSize={60}>
                    <QuickViewer />
                  </Panel>
                </>
              )}
            </PanelGroup>
          )}
        </div>
      </div>
      <ContextMenu />
    </div>
  );
}
