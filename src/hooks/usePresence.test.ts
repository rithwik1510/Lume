import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePresence } from "@/hooks/usePresence";

describe("usePresence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Route rAF through the fake-timer clock so the enter "dance" is flushable.
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) =>
      setTimeout(() => cb(0), 0)
    );
    vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
    // Motion enabled by default (matchMedia absent → prefersReducedMotion false).
    vi.stubGlobal("matchMedia", undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("starts unmounted when initially closed", () => {
    const { result } = renderHook(() => usePresence(false));
    expect(result.current.mounted).toBe(false);
    expect(result.current.state).toBe("closed");
  });

  it("mounts immediately on open and flips to the open state after a frame", () => {
    const { result, rerender } = renderHook(({ open }) => usePresence(open), {
      initialProps: { open: false },
    });
    act(() => rerender({ open: true }));
    expect(result.current.mounted).toBe(true); // mounted right away
    act(() => vi.runAllTimers()); // flush the enter rAF dance
    expect(result.current.state).toBe("open");
  });

  it("stays mounted during the exit, then unmounts after exitMs", () => {
    const { result, rerender } = renderHook(({ open }) => usePresence(open, 120), {
      initialProps: { open: false },
    });
    act(() => rerender({ open: true }));
    act(() => vi.runAllTimers());
    expect(result.current.mounted).toBe(true);

    act(() => rerender({ open: false }));
    // Still mounted while the exit transition plays; state has flipped closed.
    expect(result.current.mounted).toBe(true);
    expect(result.current.state).toBe("closed");

    act(() => vi.advanceTimersByTime(120));
    expect(result.current.mounted).toBe(false);
  });

  it("is instant under prefers-reduced-motion (no enter frame, no exit delay)", () => {
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: true,
      media: q,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent() {
        return false;
      },
    }));
    const { result, rerender } = renderHook(({ open }) => usePresence(open), {
      initialProps: { open: false },
    });
    act(() => rerender({ open: true }));
    expect(result.current.mounted).toBe(true);
    expect(result.current.state).toBe("open"); // no rAF needed

    act(() => rerender({ open: false }));
    expect(result.current.mounted).toBe(false); // no exit delay
    expect(result.current.state).toBe("closed");
  });
});
