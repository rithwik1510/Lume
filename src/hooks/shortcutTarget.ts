// Decide whether a global keyboard shortcut should yield to a focused
// editable field. Returns true to SKIP the app shortcut (let the field handle
// the key natively). The xterm.js helper textarea lives inside a `.xterm`
// container and must NOT be skipped — terminal panes rely on the capture-phase
// shortcut listener for split/focus/close, so we exclude anything inside .xterm.
export function shouldSkipShortcut(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const editable =
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT" ||
    target.isContentEditable ||
    target.getAttribute("contenteditable") === "true" ||
    target.getAttribute("contenteditable") === "";
  if (!editable) return false;
  // xterm's hidden textarea is editable but must keep firing app shortcuts.
  if (target.closest(".xterm")) return false;
  return true;
}
