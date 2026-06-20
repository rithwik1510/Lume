// Render sink — routes each pane's incoming PTY bytes to xterm (visible) or to
// a bounded hold buffer (hidden). This is the core of the freeze fix: a
// backgrounded session's output is NOT parsed into xterm in real time (parsing
// N concurrent streams on the one renderer thread is what froze the app); it is
// buffered, capped, and replayed once when the session is foregrounded.
//
// The PTY process keeps running regardless — we only defer *rendering*, never
// the agent. Attention tracking (sidebar working/needs-you) is unaffected: the
// orchestrator still calls noteOutput per chunk.
//
// FAIL-SAFE: shouldRenderLive() returns true when no pane is marked visible, so
// without a working governor every pane renders live = today's behavior.

import { ByteRing } from "@/lib/byteRing";
import { writeToTerminal } from "@/terminals/registry";
import { shouldRenderLive } from "@/terminals/visibility";
import type { PaneId } from "@/types";

/** Per-pane cap for buffered background output (drop-oldest past this). Mirrors
 *  the Rust ring's intent: a chatty background agent can't grow memory without
 *  bound; you simply lose the oldest scrollback you weren't watching. */
const HIDDEN_BUFFER_BYTES = 4 * 1024 * 1024;

const holds = new Map<PaneId, ByteRing>();

function holdFor(paneId: PaneId): ByteRing {
  let ring = holds.get(paneId);
  if (!ring) {
    ring = new ByteRing(HIDDEN_BUFFER_BYTES);
    holds.set(paneId, ring);
  }
  return ring;
}

/** Per-chunk PTY byte sink (called from the orchestrator's channel handler). */
export function ingest(paneId: PaneId, bytes: Uint8Array): void {
  if (shouldRenderLive(paneId)) {
    // Belt-and-suspenders: if this pane has stale buffered output that was never
    // replayed (only possible on the fail-safe path, where foreground() isn't
    // called), flush it first so order is preserved.
    const ring = holds.get(paneId);
    if (ring && !ring.isEmpty()) writeToTerminal(paneId, ring.takeAll());
    writeToTerminal(paneId, bytes);
  } else {
    holdFor(paneId).push(bytes);
  }
}

/** Pane became visible: flush buffered output once, then live writes resume via
 *  ingest. The governor calls this synchronously inside its store subscriber
 *  (after marking the pane visible), so no queued channel message can interleave
 *  — the replay always lands before the next live chunk. */
export function foreground(paneId: PaneId): void {
  const ring = holds.get(paneId);
  if (ring && !ring.isEmpty()) writeToTerminal(paneId, ring.takeAll());
}

/** Pane killed — drop its buffer. */
export function forget(paneId: PaneId): void {
  holds.delete(paneId);
}

/** Test/HMR reset. */
export function __resetSink(): void {
  holds.clear();
}
