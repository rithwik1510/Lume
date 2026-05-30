// src/components/TopBar.tsx
//
// Frameless custom titlebar (DESIGN.md §3, §5; CONTEXT.md "Frameless
// titlebar"). 36px tall. Drag region in the middle. Four action buttons
// on the left (☰ ⊞ ⌨ 🗎), two action buttons on the right (📄 ⚙), and
// three native window controls (min/max/close) on the far right.
//
// Critical invariant: EVERY clickable element inside the titlebar sets
// data-tauri-drag-region="false" on its root, otherwise the click is
// swallowed as a window drag. There's a regression test (TopBar.test.tsx)
// that walks the rendered DOM and asserts this.

import type { MouseEvent as ReactMouseEvent } from "react";

import styles from "@/components/TopBar.module.css";
import { useMdStore } from "@/store/mdStore";
import { useSidebarStore } from "@/store/sidebarStore";
import { useShortcutsModalStore } from "@/store/shortcutsModalStore";
import { useSplitMenuStore } from "@/store/splitMenuStore";
import { configFilePath } from "@/lib/configClient";
import { pickAndOpenFolder } from "@/lib/sessions/sessionEntryFlows";
import {
  minimizeWindow,
  toggleMaximize,
  closeWindow,
} from "@/lib/windowControls";

/** Lucide-style minimize glyph: single horizontal stroke. */
function MinIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={2} strokeLinecap="round"
      aria-hidden="true">
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

/** Lucide-style maximize glyph: rounded square. */
function MaxIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={2} strokeLinejoin="round"
      aria-hidden="true">
      <rect x="5" y="5" width="14" height="14" rx="1" />
    </svg>
  );
}

/** Lucide-style close glyph: X. */
function CloseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={2} strokeLinecap="round"
      aria-hidden="true">
      <line x1="6" y1="6" x2="18" y2="18" />
      <line x1="18" y1="6" x2="6" y2="18" />
    </svg>
  );
}

export function TopBar() {
  const mdMode = useMdStore((s) => s.mdEditorMode);
  const setMdEditorMode = useMdStore((s) => s.setMdEditorMode);
  const qvOpen = useMdStore((s) => s.quickViewer.open);
  const qvPath = useMdStore((s) => s.quickViewer.path);
  const openMdInQuickViewer = useMdStore((s) => s.openMdInQuickViewer);
  const closeQuickViewer = useMdStore((s) => s.closeQuickViewer);
  const openMdTab = useMdStore((s) => s.openMdTab);

  const sidebarVisible = useSidebarStore((s) => s.sidebarVisible);
  const toggleSidebar = useSidebarStore((s) => s.toggleSidebar);
  const workspaceFolder = useSidebarStore((s) => s.workspaceFolder);

  // ⊞ TopBar button: toggles the SplitMenu popover anchored at the
  // button's bottom-left. The popover dispatches splitPane on click;
  // the orchestrator spawns the PTY by reacting to the layout subscribe.
  //
  // The SplitMenu's window mousedown listener skips clicks on the
  // ⊞ button (via [data-split-menu-trigger]), so when the menu is open
  // and the user re-clicks ⊞, the listener does NOT close it first —
  // this handler sees store.open === true and closes the menu cleanly.
  const toggleSplitMenu = (e: ReactMouseEvent<HTMLButtonElement>) => {
    const store = useSplitMenuStore.getState();
    if (store.open) {
      store.close();
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    store.show(rect.left, rect.bottom + 4);
  };

  const onToggleQuickViewer = () => {
    if (qvOpen) {
      closeQuickViewer();
    } else if (qvPath !== null) {
      void openMdInQuickViewer(qvPath).catch((err) =>
        console.error("openMdInQuickViewer failed", err)
      );
    }
    // No-op when QV has no remembered path — matches keyboard shortcut.
  };

  const onSettings = () => {
    // Open ~/.workstation/config.toml in the MD Editor as a tab.
    void configFilePath()
      .then((path) => openMdTab(path))
      .catch((err) => console.error("opening config.toml failed", err));
  };

  return (
    <div className={styles.root} data-tauri-drag-region>
      <div className={styles.left} data-tauri-drag-region="false">
        <button
          className={`${styles.btn} ${sidebarVisible ? styles.active : ""}`}
          title={sidebarVisible ? "Hide Sidebar (Ctrl+B)" : "Show Sidebar (Ctrl+B)"}
          aria-label="Toggle Sidebar"
          data-tauri-drag-region="false"
          onClick={toggleSidebar}
        >
          ☰
        </button>
        <button
          className={styles.btn}
          title="Split focused pane (Ctrl+Alt+→/↑/↓)"
          aria-label="Split focused pane"
          data-tauri-drag-region="false"
          data-split-menu-trigger
          onClick={toggleSplitMenu}
        >
          ⊞
        </button>
        <button
          className={styles.btn}
          title="Open Folder — switch or create session (Ctrl+K Ctrl+O)"
          aria-label="Open Folder"
          data-tauri-drag-region="false"
          onClick={() => void pickAndOpenFolder()}
        >
          📂
        </button>
        <button
          className={styles.btn}
          title="Keyboard shortcuts viewer (Ctrl+?)"
          aria-label="Keyboard shortcuts"
          data-tauri-drag-region="false"
          onClick={() => useShortcutsModalStore.getState().openModal()}
        >
          ⌨
        </button>
        <button
          className={`${styles.btn} ${mdMode === "full" ? styles.active : ""}`}
          title={mdMode === "full" ? "Close MD Editor (Ctrl+E)" : "Open MD Editor (Ctrl+E)"}
          aria-label="Toggle MD Editor"
          data-tauri-drag-region="false"
          onClick={() => setMdEditorMode(mdMode === "full" ? "off" : "full")}
        >
          🗎
        </button>
      </div>

      <div
        className={styles.drag}
        data-tauri-drag-region
        // Double-click on the drag region toggles maximize (Windows convention).
        onDoubleClick={() => void toggleMaximize()}
        title={workspaceFolder ?? ""}
      />

      <div className={styles.right} data-tauri-drag-region="false">
        <button
          className={`${styles.btn} ${qvOpen ? styles.active : ""}`}
          title={qvOpen ? "Close Quick Viewer (Ctrl+Shift+M)" : "Open Quick Viewer (Ctrl+Shift+M)"}
          aria-label="Toggle Quick Viewer"
          data-tauri-drag-region="false"
          onClick={onToggleQuickViewer}
        >
          📄
        </button>
        <button
          className={styles.btn}
          title="Settings — open config.toml"
          aria-label="Settings"
          data-tauri-drag-region="false"
          onClick={onSettings}
        >
          ⚙
        </button>
        <button
          className={styles.winBtn}
          title="Minimize"
          aria-label="Minimize"
          data-tauri-drag-region="false"
          onClick={() => void minimizeWindow()}
        >
          <MinIcon />
        </button>
        <button
          className={styles.winBtn}
          title="Maximize"
          aria-label="Maximize"
          data-tauri-drag-region="false"
          onClick={() => void toggleMaximize()}
        >
          <MaxIcon />
        </button>
        <button
          className={`${styles.winBtn} ${styles.close}`}
          title="Close"
          aria-label="Close"
          data-tauri-drag-region="false"
          onClick={() => void closeWindow()}
        >
          <CloseIcon />
        </button>
      </div>
    </div>
  );
}
