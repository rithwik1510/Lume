// src/components/Toaster.tsx
//
// Renders the toastStore. Fixed bottom-right per DESIGN.md §8.
//
// Enter/exit: toasts slide in on mount and slide OUT on dismiss. The store
// removes a toast immediately, so we keep a local order-stable `rendered`
// list: when a toast leaves the store we mark it `leaving` (in place, so it
// doesn't jump position under the column-reverse stack), play the exit
// animation, then drop it after the exit duration. No store change — the
// store's dismiss/auto-dismiss semantics (and their tests) stay intact.

import { useEffect, useState } from "react";

import styles from "@/components/Toaster.module.css";
import { useToastStore } from "@/store/toastStore";

type Toast = ReturnType<typeof useToastStore.getState>["toasts"][number];

/** Matches the exit animation duration in Toaster.module.css (--dur-fast). */
const EXIT_MS = 120;

interface Rendered {
  toast: Toast;
  leaving: boolean;
}

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  const [rendered, setRendered] = useState<Rendered[]>(() =>
    toasts.map((t) => ({ toast: t, leaving: false }))
  );

  // Sync the local list with the store: keep order, mark vanished toasts as
  // leaving (in place), append newly-pushed ones.
  useEffect(() => {
    setRendered((cur) => {
      const storeIds = new Set(toasts.map((t) => t.id));
      const curIds = new Set(cur.map((r) => r.toast.id));
      const next = cur.map((r) =>
        storeIds.has(r.toast.id) || r.leaving ? r : { ...r, leaving: true }
      );
      for (const t of toasts) {
        if (!curIds.has(t.id)) next.push({ toast: t, leaving: false });
      }
      return next;
    });
  }, [toasts]);

  // Drop leaving toasts once their exit animation has played.
  useEffect(() => {
    const leaving = rendered.filter((r) => r.leaving);
    if (leaving.length === 0) return;
    const timers = leaving.map((r) =>
      window.setTimeout(() => {
        setRendered((cur) => cur.filter((x) => x.toast.id !== r.toast.id));
      }, EXIT_MS)
    );
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [rendered]);

  return (
    <div className={styles.root} aria-live="polite" aria-atomic="false">
      {/* No role="status" on each toast — the container's aria-live is the
       *  semantic anchor for the toast list. role="status" carries implicit
       *  aria-live="polite", which would double-announce on NVDA / JAWS. */}
      {rendered.map(({ toast: t, leaving }) => (
        <div
          key={t.id}
          className={`${styles.toast} ${leaving ? styles.leaving : ""}`}
        >
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
