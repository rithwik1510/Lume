// src/lib/confirmStrings.ts
//
// Centralised user-facing strings for confirm dialogs. Two call sites
// (PaneTree's × button and the Ctrl+W keyboard shortcut) close panes;
// they MUST stay in sync.

export function closeBusyPaneConfirm(paneId: string) {
  return {
    title: "Close pane with running process?",
    message: `${paneId} appears to be running a process. Closing the pane will terminate it.`,
    confirmLabel: "Close anyway",
    cancelLabel: "Keep open",
    danger: true as const,
  };
}

// Shown when Ctrl+W would close the last remaining pane in the active session.
// Unlike pane close, this stops the whole session (kept in the sidebar for
// reactivation), so the wording makes the session-level consequence explicit.
// Not danger-styled: stopping is reversible (the session is remembered).
export function closeLastPaneInSessionConfirm(sessionName: string) {
  return {
    title: "Stop session?",
    message: `This is the last pane in "${sessionName}". Closing it will stop the session — it stays in the sidebar and you can revive it later. Continue?`,
    confirmLabel: "Stop session",
    cancelLabel: "Keep open",
    danger: false as const,
  };
}
