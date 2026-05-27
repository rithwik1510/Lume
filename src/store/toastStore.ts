// src/store/toastStore.ts
//
// Toast notifications per DESIGN.md §8. Position bottom-right, max 4 visible,
// stack newest-on-top. Severity controls left-edge colour AND auto-dismiss
// timing:
//   success — 3s  (green left edge)
//   info    — 3s  (amber left edge)
//   warn    — 6s  (amber-dim left edge)
//   error   — sticky, requires explicit dismiss (red left edge)
//
// Timer references live in a module-level Map so we can clear them on
// explicit dismiss. The store itself stays a plain array.

import { create } from "zustand";
import { devtools } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

export type ToastSeverity = "success" | "info" | "warn" | "error";

export interface Toast {
  id: string;
  severity: ToastSeverity;
  message: string;
  createdAt: number;
}

const MAX_VISIBLE = 4;

const DISMISS_MS: Record<ToastSeverity, number | null> = {
  success: 3000,
  info: 3000,
  warn: 6000,
  error: null,
};

const timers = new Map<string, ReturnType<typeof setTimeout>>();

let _seq = 0;
const nextId = () => `toast-${++_seq}`;

interface ToastState {
  toasts: Toast[];
}

interface ToastActions {
  push: (input: { severity: ToastSeverity; message: string }) => string;
  dismiss: (id: string) => void;
  reset: () => void;
}

export type ToastStore = ToastState & ToastActions;

export const useToastStore = create<ToastStore>()(
  devtools(
    immer((set, get) => ({
      toasts: [],

      push: ({ severity, message }) => {
        const id = nextId();
        const toast: Toast = { id, severity, message, createdAt: Date.now() };
        set((s) => {
          s.toasts.push(toast);
          // Cap at MAX_VISIBLE; drop oldest by shifting from the front.
          while (s.toasts.length > MAX_VISIBLE) {
            const dropped = s.toasts.shift();
            if (dropped) {
              const t = timers.get(dropped.id);
              if (t) {
                clearTimeout(t);
                timers.delete(dropped.id);
              }
            }
          }
        });
        const ms = DISMISS_MS[severity];
        if (ms !== null) {
          const handle = setTimeout(() => {
            get().dismiss(id);
          }, ms);
          timers.set(id, handle);
        }
        return id;
      },

      dismiss: (id) => {
        const t = timers.get(id);
        if (t) {
          clearTimeout(t);
          timers.delete(id);
        }
        set((s) => {
          s.toasts = s.toasts.filter((t) => t.id !== id);
        });
      },

      reset: () => {
        for (const t of timers.values()) clearTimeout(t);
        timers.clear();
        set((s) => {
          s.toasts = [];
        });
      },
    })),
    { name: "toastStore" }
  )
);
