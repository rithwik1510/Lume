// Bounded byte buffer with drop-oldest overflow — the renderer-side hold buffer
// for a backgrounded (suspended) pane's PTY output.
//
// While a session is off-screen we stop feeding its bytes into xterm (parsing
// is the expensive, freeze-causing work). The bytes still arrive from Rust, so
// we stash them here, capped, dropping the oldest when full — exactly mirroring
// the Rust-side RingBuf semantics (pty.rs). On foreground, takeAll() drains it
// and we replay into xterm once.
//
// Drop granularity is whole chunks (a chunk = one 32 ms IPC flush, tens of KB),
// which keeps push O(1) amortised; the cap is therefore approximate to within
// one chunk, which is irrelevant at a multi-MB cap. A single chunk larger than
// the cap keeps only its tail.

export class ByteRing {
  private chunks: Uint8Array[] = [];
  private total = 0;

  constructor(private readonly cap: number) {}

  /** Append a copy of `bytes` (the source may be a transient view over an IPC
   *  buffer, so we never retain it by reference). Drops oldest chunks to stay
   *  within `cap`. */
  push(bytes: Uint8Array): void {
    if (bytes.length === 0) return;
    this.chunks.push(bytes.slice());
    this.total += bytes.length;
    while (this.total > this.cap && this.chunks.length > 1) {
      this.total -= this.chunks.shift()!.length;
    }
    // A lone chunk bigger than the whole cap: keep only its last `cap` bytes.
    if (this.total > this.cap && this.chunks.length === 1) {
      const only = this.chunks[0];
      const tail = only.slice(only.length - this.cap);
      this.chunks[0] = tail;
      this.total = tail.length;
    }
  }

  /** Concatenate everything buffered and reset to empty. */
  takeAll(): Uint8Array {
    if (this.chunks.length === 0) return new Uint8Array(0);
    if (this.chunks.length === 1) {
      const out = this.chunks[0];
      this.clear();
      return out;
    }
    const out = new Uint8Array(this.total);
    let offset = 0;
    for (const c of this.chunks) {
      out.set(c, offset);
      offset += c.length;
    }
    this.clear();
    return out;
  }

  isEmpty(): boolean {
    return this.total === 0;
  }

  clear(): void {
    this.chunks = [];
    this.total = 0;
  }

  get length(): number {
    return this.total;
  }
}
