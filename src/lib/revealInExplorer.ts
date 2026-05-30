// Opens the given path in the OS file explorer. Wraps Tauri's plugin-shell.
//
// Failure is silent (warn-only) — the context-menu UX shouldn't show error
// toasts for a missing shell binding; if the platform doesn't support
// reveal, the action is a no-op the user can shrug off.

export async function revealInExplorer(path: string): Promise<void> {
  try {
    const { open } = await import("@tauri-apps/plugin-shell");
    await open(path);
  } catch (err) {
    console.warn("revealInExplorer failed", err);
  }
}
