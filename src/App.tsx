// Lume root. Horizontal flex layout, left → right:
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
import { Preview } from "@/components/Preview";
import { QuickViewer } from "@/components/QuickViewer";
import { SessionsSidebar } from "@/components/SessionsSidebar";
import { SettingsModal } from "@/components/SettingsModal";
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
import { usePreviewStore } from "@/store/previewStore";
import { useSessionsStore } from "@/store/sessionsStore";
import { useSettingsStore } from "@/store/settingsStore";
import { useSidebarStore } from "@/store/sidebarStore";
import { applyXtermFontFamilyToAll, applyXtermThemeToAll } from "@/terminals/registry";
import { installPtyOrchestrator } from "@/terminals/orchestrator";
import { useExternalFileDrop } from "@/hooks/useExternalFileDrop";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { coerceThemeName } from "@/lib/themes";
import { coerceFontPair } from "@/lib/fontPairs";
import { checkForUpdatesOnLaunch } from "@/lib/updater";

export default function App() {
  const quickViewerOpen = useMdStore((s) => s.quickViewer.open);
  const previewOpen = usePreviewStore((s) => s.open);
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

      // Feature A — reopen the last active session on a routine restart.
      // Migration only seeds on fresh install / v0.1 upgrade; on a normal
      // relaunch it returns null, so revive the session the user last had open
      // (when the preference is on and it still exists). Activating it makes the
      // orchestrator's subscriber spawn its panes — each with its remembered
      // shell, and its remembered command pre-filled at the prompt (feature B).
      const ss = useSessionsStore.getState();
      if (
        !seededId &&
        ss.activeSessionId === null &&
        ss.reopenLastSession &&
        ss.lastActiveSessionId &&
        ss.sessions[ss.lastActiveSessionId]
      ) {
        ss.activateSession(ss.lastActiveSessionId);
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

  // Update check — runs once at boot in release builds only.
  // Dev builds have no updater endpoint, so we guard on import.meta.env.PROD
  // to avoid noisy network errors during development.
  useEffect(() => {
    if (import.meta.env.PROD) {
      void checkForUpdatesOnLaunch();
    }
  }, []);

  // Theme application — settings.theme.accent → data-theme on :root.
  // CSS modules read the swapped --bg/--fg/--accent variables, then every
  // live xterm Terminal gets its theme re-applied so the WebGL atlas
  // regenerates against the new palette. Atomic selector so we re-run only
  // when the accent name changes, not on every settings field write.
  const themeAccent = useSettingsStore((s) => s.config.theme.accent);
  useEffect(() => {
    const name = coerceThemeName(themeAccent);
    document.documentElement.setAttribute("data-theme", name);
    applyXtermThemeToAll();
  }, [themeAccent]);

  // Font pair application — settings.font.pair → data-font-pair on :root.
  // CSS swaps --font-ui and --font-mono atomically; xterm then needs an
  // explicit fontFamily push so existing Terminals re-measure cells against
  // the new mono. New Terminals already pick the resolved stack up via
  // registry.ts reading --font-mono at construction.
  const fontPair = useSettingsStore((s) => s.config.font.pair);
  useEffect(() => {
    const name = coerceFontPair(fontPair);
    document.documentElement.setAttribute("data-font-pair", name);
    applyXtermFontFamilyToAll();
  }, [fontPair]);

  // Wire keyboard shortcuts (W2-P3): split/focus/close.
  useKeyboardShortcuts();

  useExternalFileDrop();

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
            <PanelGroup
              direction="horizontal"
              id="pg-root-h"
              key={`pg-root-${quickViewerOpen ? 1 : 0}-${previewOpen ? 1 : 0}`}
            >
              <Panel
                defaultSize={
                  quickViewerOpen && previewOpen
                    ? 45
                    : previewOpen
                      ? 55
                      : quickViewerOpen
                        ? 75
                        : 100
                }
                minSize={40}
              >
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
              {previewOpen && (
                <>
                  <PanelResizeHandle
                    onDragging={(isDragging) => {
                      if (isDragging) beginResize();
                      else endResize();
                    }}
                    style={{ width: 3, background: "var(--border)", cursor: "col-resize" }}
                  />
                  <Panel defaultSize={quickViewerOpen ? 30 : 45} minSize={25} maxSize={70}>
                    <Preview />
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
      <SettingsModal />
    </div>
  );
}
