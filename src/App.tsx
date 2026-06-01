// Workstation root. Horizontal flex layout, left → right:
//   SessionsSidebar (sessions grouped by folder; toggled by ☰ / Ctrl+B)
//   FileDrawer      (active session's file tree; toggled by 🗂 / Ctrl+Shift+E,
//                    renders null when the active session's fileTreeOpen is false)
//   central area    (MainArea PaneTree mux + optional MD Quick Viewer panel)
//
// The central area is a horizontal PanelGroup so the MD Quick Viewer can dock
// on the right (default 25%, min 20%, max 60%) when open.
//
// When MD Editor mode is "full", the entire central area is replaced by the
// <MdEditor /> per CONTEXT.md: "the Tiling Area + MD Quick Viewer area are
// replaced by a single full-width CodeMirror 6 editor with the open MD Tabs
// across the top. The Sidebar remains visible." The sidebars and the
// ContextMenu portal stay mounted alongside.

import { useEffect } from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ContextMenu } from "@/components/ContextMenu";
import { FileDrawer } from "@/components/FileDrawer";
import { MainArea } from "@/components/MainArea";
import { MdEditor } from "@/components/MdEditor";
import { QuickViewer } from "@/components/QuickViewer";
import { SessionsSidebar } from "@/components/SessionsSidebar";
import { ShortcutsModal } from "@/components/ShortcutsModal";
import { SplitMenu } from "@/components/SplitMenu";
import { StatusBar } from "@/components/StatusBar";
import { Toaster } from "@/components/Toaster";
import { TopBar } from "@/components/TopBar";
import { beginResize, endResize } from "@/components/resizeBus";
import { installBranchPoller } from "@/sessions/branchPoller";
import { runMigrationIfNeeded } from "@/sessions/migration";
import { useLayoutStore } from "@/store/layoutStore";
import { useMdStore } from "@/store/mdStore";
import { useSessionsStore } from "@/store/sessionsStore";
import { useSidebarStore } from "@/store/sidebarStore";
import { installPtyOrchestrator } from "@/terminals/orchestrator";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";

export default function App() {
  const quickViewerOpen = useMdStore((s) => s.quickViewer.open);
  const mdMode = useMdStore((s) => s.mdEditorMode);

  useEffect(() => {
    const dispose = installPtyOrchestrator();
    const disposePoller = installBranchPoller();

    const bootstrap = async () => {
      // By the time this runs, sessionsStore has rehydrated and
      // coerceRehydrated has set every persisted session to stopped with
      // activeSessionId null. runMigrationIfNeeded seeds a session on fresh
      // install / v0.1 upgrade (returning its id to activate) or returns null
      // on a routine restart (persisted sessions stay all-stopped per §3).
      const oldRoot = useLayoutStore.getState().root; // façade → null at cold start
      const oldWs = useSidebarStore.getState().workspaceFolder;
      const seededId = await runMigrationIfNeeded({
        oldLayoutRoot: oldRoot,
        oldWorkspaceFolder: oldWs,
      });
      if (seededId) {
        useSessionsStore.getState().activateSession(seededId);
      }

      // If the now-active session has no layout yet, seed its first pane. On a
      // routine restart nothing is active, so this is skipped and the user
      // sees the all-stopped sidebar until they click a session to revive.
      const layout = useLayoutStore.getState();
      if (layout.root === null && useSessionsStore.getState().activeSessionId !== null) {
        layout.initWithFirstPane("pane-1");
      }
    };

    // Gate on sessionsStore hydration — sessions live there now. Running before
    // it rehydrates would seed a stray home session that the wholesale
    // rehydrate setState then wipes (spawn-then-orphan flash). layoutStore's
    // own persist is a no-op shim (partialize () => ({})); its bridge
    // re-mirrors after sessionsStore hydrates, so gating here is sufficient.
    let unsubFinishHydration: (() => void) | undefined;
    if (useSessionsStore.persist.hasHydrated()) {
      void bootstrap();
    } else {
      unsubFinishHydration = useSessionsStore.persist.onFinishHydration(() => {
        void bootstrap();
      });
    }

    return () => {
      if (unsubFinishHydration) unsubFinishHydration();
      disposePoller();
      dispose();
    };
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
        {/* Always mounted — SessionsSidebar animates its own width collapse from
            sidebarStore.sidebarVisible (☰ / Ctrl+B). Gating with `&&` here would
            mount/unmount it instantly and defeat the open/close animation. */}
        <SessionsSidebar />
        {/* FileDrawer renders null unless the active session has fileTreeOpen.
            Its visibility is owned by the 🗂 topbar toggle (and Ctrl+Shift+E),
            independent of the sessions-sidebar visibility (☰ / Ctrl+B). */}
        <FileDrawer />
        <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
          {mdMode === "full" ? (
            <MdEditor />
          ) : (
            <PanelGroup direction="horizontal" id="pg-root-h">
              <Panel defaultSize={quickViewerOpen ? 75 : 100} minSize={40}>
                <MainArea />
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
      <StatusBar />
      <ContextMenu />
      <Toaster />
      <ConfirmDialog />
      <SplitMenu />
      <ShortcutsModal />
    </div>
  );
}
