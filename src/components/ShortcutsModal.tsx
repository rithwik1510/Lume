// src/components/ShortcutsModal.tsx
//
// Read-only modal listing every keyboard shortcut from DESIGN.md §7,
// grouped by category. The CATALOG below is a static array — when
// DESIGN.md §7 changes, update here. There's no shared source of truth
// in v0.1; v0.2 polish could derive this from a config layer.
//
// Esc dismisses (capture-phase keydown so it wins over xterm when a
// Terminal Pane has DOM focus underneath). Backdrop click also closes;
// clicks inside the modal body do not (event.stopPropagation on the
// inner container).

import { useEffect } from "react";

import styles from "@/components/ShortcutsModal.module.css";
import { useShortcutsModalStore } from "@/store/shortcutsModalStore";

interface ShortcutRow {
  label: string;
  keys: string[];
}
interface ShortcutGroup {
  name: string;
  rows: ShortcutRow[];
}

const CATALOG: ShortcutGroup[] = [
  {
    name: "Panes",
    rows: [
      { label: "Split right", keys: ["Ctrl", "Alt", "→"] },
      { label: "Split up", keys: ["Ctrl", "Alt", "↑"] },
      { label: "Split down", keys: ["Ctrl", "Alt", "↓"] },
      { label: "Focus right / left / up / down", keys: ["Ctrl", "→ ← ↑ ↓"] },
      { label: "Close focused pane", keys: ["Ctrl", "W"] },
      { label: "Reset terminal mouse modes (focused)", keys: ["Ctrl", "Shift", "R"] },
    ],
  },
  {
    name: "Surfaces",
    rows: [
      { label: "Toggle Sidebar", keys: ["Ctrl", "B"] },
      { label: "Toggle MD Editor Full View", keys: ["Ctrl", "E"] },
      { label: "Toggle MD Quick Viewer", keys: ["Ctrl", "Shift", "M"] },
      { label: "Open .md file", keys: ["Ctrl", "O"] },
      { label: "Open Folder (workspace)", keys: ["Ctrl", "K", "Ctrl", "O"] },
      { label: "Show keyboard shortcuts", keys: ["Ctrl", "?"] },
    ],
  },
  {
    name: "MD Editor",
    rows: [
      { label: "Save", keys: ["Ctrl", "S"] },
      { label: "Cycle MD Editor tabs", keys: ["Ctrl", "Tab"] },
      { label: "Find in focused element", keys: ["Ctrl", "F"] },
      { label: "Find & replace", keys: ["Ctrl", "H"] },
      { label: "Find across all open MD tabs", keys: ["Ctrl", "Shift", "F"] },
    ],
  },
  {
    name: "Clipboard",
    rows: [
      { label: "Copy / paste (terminal pane)", keys: ["Ctrl", "Shift", "C / V"] },
      { label: "Copy / paste / cut (non-terminal)", keys: ["Ctrl", "C / V / X"] },
    ],
  },
  {
    name: "Font",
    rows: [
      { label: "Increase / decrease / reset font size", keys: ["Ctrl", "= / - / 0"] },
    ],
  },
];

export function ShortcutsModal() {
  const open = useShortcutsModalStore((s) => s.open);
  const close = useShortcutsModalStore((s) => s.closeModal);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, close]);

  if (!open) return null;

  return (
    <div
      className={styles.backdrop}
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-modal-title"
    >
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header} id="shortcuts-modal-title">
          Keyboard shortcuts
          <button
            className={styles.closeBtn}
            onClick={close}
            aria-label="Close shortcuts modal"
            title="Close (Esc)"
          >
            ×
          </button>
        </div>
        <div className={styles.body}>
          {CATALOG.map((group) => (
            <div key={group.name} className={styles.group}>
              <div className={styles.groupHeader}>{group.name}</div>
              {group.rows.map((row) => (
                <div key={row.label} className={styles.row}>
                  <span className={styles.label}>{row.label}</span>
                  <span className={styles.keys}>
                    {row.keys.map((k, i) => (
                      <kbd key={`${row.label}-${i}`} className={styles.key}>
                        {k}
                      </kbd>
                    ))}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
