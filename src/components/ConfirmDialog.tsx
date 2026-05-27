// src/components/ConfirmDialog.tsx
//
// Generic confirm dialog rendered from confirmStore state. Mounted once
// at App root as a sibling to other portal-style overlays. Single
// dialog at a time — the store enforces that (see confirmStore.ts).
//
// Keyboard behaviour:
//   - Esc → resolve(false)
//   - Enter → resolve(true)
//   - Backdrop click → resolve(false)
//   - Inside-dialog clicks do NOT bubble to the backdrop.
//
// Listener is attached in the capture phase so it wins over xterm's
// own keydown handler when a Terminal Pane has DOM focus underneath.

import { useEffect } from "react";
import styles from "@/components/ConfirmDialog.module.css";
import { useConfirmStore } from "@/store/confirmStore";

export function ConfirmDialog() {
  const open = useConfirmStore((s) => s.open);
  const request = useConfirmStore((s) => s.request);
  const resolve = useConfirmStore((s) => s.resolve);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        resolve(false);
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        resolve(true);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, resolve]);

  if (!open || !request) return null;

  const confirmLabel = request.confirmLabel ?? "Confirm";
  const cancelLabel = request.cancelLabel ?? "Cancel";
  const danger = request.danger === true;

  return (
    <div
      className={styles.backdrop}
      onClick={() => resolve(false)}
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header} id="confirm-dialog-title">
          {request.title}
        </div>
        <div className={styles.body}>{request.message}</div>
        <div className={styles.footer}>
          <button
            type="button"
            className={styles.btn}
            onClick={() => resolve(false)}
            autoFocus={!danger}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`${styles.btn} ${danger ? styles.danger : styles.confirm}`}
            onClick={() => resolve(true)}
            autoFocus={danger}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
