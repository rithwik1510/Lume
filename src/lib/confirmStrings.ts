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
