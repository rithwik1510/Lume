import { describe, it, expect, vi } from "vitest";

import { RendererPool } from "@/terminals/webglPool";

function makePool(cap: number) {
  const activated: string[] = [];
  const evicted: string[] = [];
  const pool = new RendererPool(cap, {
    activate: (id) => {
      activated.push(id);
      return true; // pretend WebGL always creates in tests
    },
    evict: (id) => {
      evicted.push(id);
    },
  });
  return { pool, activated, evicted };
}

describe("RendererPool", () => {
  it("activates a pane on acquire and counts it", () => {
    const { pool, activated } = makePool(3);
    pool.acquire("a");
    expect(activated).toEqual(["a"]);
    expect(pool.isActive("a")).toBe(true);
    expect(pool.activeCount()).toBe(1);
  });

  it("does not re-activate an already-active pane", () => {
    const { pool, activated } = makePool(3);
    pool.acquire("a");
    pool.acquire("a");
    expect(activated).toEqual(["a"]);
  });

  it("never evicts a visible (pinned) pane, even past cap", () => {
    const { pool, evicted } = makePool(2);
    pool.acquire("a");
    pool.acquire("b");
    pool.acquire("c"); // 3 visible > cap 2, but all pinned
    expect(evicted).toEqual([]);
    expect(pool.activeCount()).toBe(3);
  });

  it("evicts the LRU background pane when a new visible pane needs room", () => {
    const { pool, evicted } = makePool(2);
    pool.acquire("a");
    pool.acquire("b");
    pool.markBackground("a"); // a is now evictable, still active/warm
    pool.markBackground("b"); // b evictable too
    pool.acquire("c"); // need room → evict LRU background = a
    expect(evicted).toEqual(["a"]);
    expect(pool.isActive("a")).toBe(false);
    expect(pool.isActive("b")).toBe(true);
    expect(pool.isActive("c")).toBe(true);
  });

  it("keeps a backgrounded pane warm until cap pressure", () => {
    const { pool, evicted } = makePool(3);
    pool.acquire("a");
    pool.markBackground("a");
    expect(evicted).toEqual([]); // under cap → stays warm
    expect(pool.isActive("a")).toBe(true);
  });

  it("re-acquiring a warm background pane re-pins it (no atlas churn)", () => {
    const { pool, activated, evicted } = makePool(2);
    pool.acquire("a");
    pool.markBackground("a");
    pool.acquire("a"); // back to foreground while still warm
    expect(activated).toEqual(["a"]); // not re-activated
    expect(evicted).toEqual([]);
    expect(pool.isActive("a")).toBe(true);
  });

  it("evicts least-recently-used background panes first", () => {
    const { pool, evicted } = makePool(2);
    pool.acquire("a");
    pool.markBackground("a");
    pool.acquire("b");
    pool.markBackground("b"); // order [a, b], both background, at cap
    pool.acquire("c"); // need room → evict LRU background = a (not b)
    expect(evicted).toEqual(["a"]);
    expect(pool.isActive("a")).toBe(false);
    expect(pool.isActive("b")).toBe(true);

    pool.acquire("d"); // c,d would be 4 active... b is the next LRU background
    expect(evicted).toEqual(["a", "b"]);
  });

  it("retries activation if it was deferred", () => {
    let ready = false;
    const activate = vi.fn((_id: string) => ready);
    const pool = new RendererPool(3, { activate, evict: vi.fn() });
    pool.acquire("a"); // deferred (not ready)
    expect(pool.isActive("a")).toBe(false);
    ready = true;
    pool.acquire("a"); // retry succeeds
    expect(pool.isActive("a")).toBe(true);
    expect(activate).toHaveBeenCalledTimes(2);
  });

  it("forget drops all bookkeeping without calling evict", () => {
    const { pool, evicted } = makePool(2);
    pool.acquire("a");
    pool.forget("a");
    expect(evicted).toEqual([]); // registry disposes with the Terminal
    expect(pool.isActive("a")).toBe(false);
    expect(pool.activeCount()).toBe(0);
  });
});
