// WebGL context pool — bounds the number of live xterm WebGL renderers.
//
// WebView2 / Chromium force-loses the oldest WebGL context once ~16 are alive
// ("Too many active WebGL contexts"), which drops a pane to the slow DOM
// renderer and can thrash the GPU process under load. Today every pane that was
// ever shown holds a context forever (registry.ts created one per attach), so a
// fleet of sessions blows past the cap.
//
// This pool keeps at most `cap` WebGL contexts alive, evicting the
// least-recently-used HIDDEN pane when a new one is needed. Visible panes are
// "pinned" and never evicted (you always see crisp output for what's on
// screen). Recently-backgrounded panes stay warm until cap pressure forces
// their eviction, so a quick switch-back avoids an atlas-regeneration flash.
//
// Pure bookkeeping: the actual WebGL create/dispose is injected via callbacks,
// so this class is unit-testable without a GPU. `activate` returns false if the
// renderer could not be created yet (e.g. the terminal isn't open) — the pane
// is then left inactive and a later acquire() retries.

import type { PaneId } from "@/types";

export interface RendererPoolCallbacks {
  /** Create the WebGL renderer for this pane. Return true if it is now active,
   *  false if creation was deferred (no terminal/element yet) or failed. */
  activate(paneId: PaneId): boolean;
  /** Dispose this pane's WebGL renderer (reverts it to the DOM renderer). */
  evict(paneId: PaneId): void;
}

export class RendererPool {
  /** LRU order, most-recently-used at the end. */
  private order: PaneId[] = [];
  /** Panes that currently hold a live renderer. */
  private active = new Set<PaneId>();
  /** Visible panes — pinned, never evicted. */
  private pinned = new Set<PaneId>();

  constructor(
    private readonly cap: number,
    private readonly cb: RendererPoolCallbacks
  ) {}

  /** Pane became visible: pin it, ensure it has a renderer, bump it to MRU. */
  acquire(paneId: PaneId): void {
    this.pinned.add(paneId);
    this.touch(paneId);
    if (!this.active.has(paneId)) {
      if (this.cb.activate(paneId)) this.active.add(paneId);
    }
    this.evictIfNeeded();
  }

  /** Pane went background: unpin (now eligible for eviction under pressure).
   *  Its renderer is kept warm until the cap forces eviction. */
  markBackground(paneId: PaneId): void {
    this.pinned.delete(paneId);
    this.evictIfNeeded();
  }

  /** Pane destroyed — drop all bookkeeping (its renderer is disposed with the
   *  Terminal by the registry, so we do not call evict here). */
  forget(paneId: PaneId): void {
    this.pinned.delete(paneId);
    this.active.delete(paneId);
    const i = this.order.indexOf(paneId);
    if (i !== -1) this.order.splice(i, 1);
  }

  /** The browser lost this pane's context externally — it is no longer active,
   *  but its slot/order bookkeeping is unaffected. */
  noteContextLost(paneId: PaneId): void {
    this.active.delete(paneId);
  }

  private touch(paneId: PaneId): void {
    const i = this.order.indexOf(paneId);
    if (i !== -1) this.order.splice(i, 1);
    this.order.push(paneId);
  }

  private evictIfNeeded(): void {
    // Walk LRU→MRU, evicting unpinned active panes until within cap. Pinned
    // (visible) panes are never evicted — so the count can legitimately exceed
    // `cap` if more than `cap` panes are visible at once (rare; still < 16).
    for (let i = 0; i < this.order.length && this.active.size > this.cap; i++) {
      const id = this.order[i];
      if (!this.active.has(id) || this.pinned.has(id)) continue;
      this.active.delete(id);
      this.cb.evict(id);
    }
  }

  // ---- test/inspection helpers ----
  activeCount(): number {
    return this.active.size;
  }
  isActive(paneId: PaneId): boolean {
    return this.active.has(paneId);
  }
}
