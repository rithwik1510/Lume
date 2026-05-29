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

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ContextMenu } from "@/components/ContextMenu";
import { MainArea } from "@/components/MainArea";
import { MdEditor } from "@/components/MdEditor";
import { QuickViewer } from "@/components/QuickViewer";
import { SessionsSidebar } from "@/components/SessionsSidebar";
import { ShortcutsModal } from "@/components/ShortcutsModal";
import { Sidebar } from "@/components/Sidebar";
import { SplitMenu } from "@/components/SplitMenu";
import { StatusBar } from "@/components/StatusBar";
import { Toaster } from "@/components/Toaster";
import { TopBar } from "@/components/TopBar";
import { beginResize, endResize } from "@/components/resizeBus";
import { homeDir } from "@/lib/fsClient";
import { useLayoutStore } from "@/store/layoutStore";
import { useMdStore } from "@/store/mdStore";
import { sessionsForFolder, useSessionsStore } from "@/store/sessionsStore";
import { useSidebarStore } from "@/store/sidebarStore";
import { installPtyOrchestrator } from "@/terminals/orchestrator";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";

export default function App() {
  const quickViewerOpen = useMdStore((s) => s.quickViewer.open);
  const mdMode = useMdStore((s) => s.mdEditorMode);
  const sidebarVisible = useSidebarStore((s) => s.sidebarVisible);

  useEffect(() => {
    const dispose = installPtyOrchestrator();

    const bootstrapEmptyLayout = async () => {
      // The façade requires an *active* session before initWithFirstPane will
      // do anything — useLayoutStore.root mirrors the active session's
      // layoutRoot, so with no session it's stuck at null. Phase 1 smoke:
      // ensure a session exists and is active, then let initWithFirstPane
      // populate its pane tree.
      const sessions = useSessionsStore.getState();
      if (Object.keys(sessions.sessions).length === 0) {
        // No sessions exist yet — create one at the user's home dir. Phase 8
        // will replace this with the migration logic that imports the legacy
        // layoutStore root + folderPath into a real session.
        //
        // Idempotency guard: even when sessions is empty at the top, the
        // homeDir await is async — under React Strict Mode (dev double-mount)
        // or a second invocation in the same tick we could race ourselves
        // into two sessions. After awaiting, re-read state and prefer an
        // existing same-folder MRU session over creating a duplicate.
        const home = await homeDir();
        const fresh = useSessionsStore.getState();
        const existing = sessionsForFolder(fresh, home);
        if (existing.length > 0) {
          fresh.activateSession(existing[0]!.id);
        } else {
          const id = fresh.createSession(home, "New session");
          fresh.activateSession(id);
        }
      } else if (sessions.activeSessionId === null) {
        // Persisted sessions exist but none is active. Phase 8 spec §3 says
        // cold start should be all-stopped; until we have UI to revive them,
        // activate the MRU so the user sees their last project.
        const mru = Object.values(sessions.sessions).sort(
          (a, b) => b.lastActiveAt - a.lastActiveAt
        )[0];
        if (mru) sessions.activateSession(mru.id);
      }

      const { root: existingRoot, initWithFirstPane } = useLayoutStore.getState();
      if (existingRoot === null) {
        // One pane at launch — user splits via Ctrl+Alt+→/↓/↑.
        // The Weekend 1 4-pane bootstrap was smoothness-baseline scaffolding,
        // not the real product UX.
        initWithFirstPane("pane-1");
      }
    };

    // Wait for layoutStore's persist middleware to finish rehydrating before
    // running the empty-layout bootstrap. Otherwise we'd spawn pane-1 and
    // immediately kill it once rehydrate replaces root with the persisted
    // tree — a visible flash plus wasted PTY work. hasHydrated() returns true
    // if rehydration has already completed (e.g. on HMR); otherwise we wait
    // on onFinishHydration's callback.
    let unsubFinishHydration: (() => void) | undefined;
    if (useLayoutStore.persist.hasHydrated()) {
      void bootstrapEmptyLayout();
    } else {
      unsubFinishHydration = useLayoutStore.persist.onFinishHydration(() => {
        void bootstrapEmptyLayout();
      });
    }

    return () => {
      if (unsubFinishHydration) unsubFinishHydration();
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
        {sidebarVisible && <SessionsSidebar />}
        {sidebarVisible && <Sidebar />}
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
