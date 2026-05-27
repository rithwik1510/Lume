import { describe, it, expect, beforeEach, vi } from "vitest";
import { useToastStore, type ToastSeverity } from "@/store/toastStore";

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: vi.fn(async () => null),
    set: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  })),
}));

describe("toastStore", () => {
  beforeEach(() => {
    useToastStore.getState().reset();
    vi.useFakeTimers();
  });

  it("push adds a toast with a unique id", () => {
    useToastStore.getState().push({ severity: "success", message: "Saved" });
    useToastStore.getState().push({ severity: "info", message: "Reloaded" });
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(2);
    expect(new Set(toasts.map((t) => t.id)).size).toBe(2);
  });

  it("dismiss removes the toast by id", () => {
    const id = useToastStore.getState().push({ severity: "info", message: "x" });
    useToastStore.getState().dismiss(id);
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("success/info/warn auto-dismiss after their duration", () => {
    useToastStore.getState().push({ severity: "success", message: "ok" });
    useToastStore.getState().push({ severity: "warn", message: "careful" });
    expect(useToastStore.getState().toasts).toHaveLength(2);

    vi.advanceTimersByTime(3001);
    // success has 3s timeout — gone
    let remaining: ToastSeverity[] = useToastStore.getState().toasts.map((t) => t.severity);
    expect(remaining).toEqual(["warn"]);

    vi.advanceTimersByTime(2998);
    // total ~5999ms — warn has 6s timeout — still present
    remaining = useToastStore.getState().toasts.map((t) => t.severity);
    expect(remaining).toEqual(["warn"]);

    vi.advanceTimersByTime(3000);
    // total ~8999ms — warn now gone
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("error toasts are sticky (no auto-dismiss)", () => {
    useToastStore.getState().push({ severity: "error", message: "fail" });
    vi.advanceTimersByTime(60_000);
    expect(useToastStore.getState().toasts).toHaveLength(1);
  });

  it("caps to MAX_VISIBLE toasts, dropping the oldest", () => {
    for (let i = 0; i < 8; i++) {
      useToastStore.getState().push({ severity: "info", message: `t${i}` });
    }
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(4); // MAX_VISIBLE
    expect(toasts.map((t) => t.message)).toEqual(["t4", "t5", "t6", "t7"]);
  });
});
