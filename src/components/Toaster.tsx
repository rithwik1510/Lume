// src/components/Toaster.tsx
//
// Renders the toastStore. Fixed bottom-right per DESIGN.md §8.

import styles from "@/components/Toaster.module.css";
import { useToastStore } from "@/store/toastStore";

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  return (
    <div className={styles.root} aria-live="polite" aria-atomic="false">
      {toasts.map((t) => (
        <div key={t.id} className={styles.toast} role="status">
          <div className={`${styles.edge} ${styles[t.severity]}`} />
          <div className={styles.body}>
            <span className={styles.message}>{t.message}</span>
            <button
              className={styles.closeBtn}
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss notification"
              title="Dismiss"
            >
              ×
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
