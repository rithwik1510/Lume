import { describe, it, expect } from "vitest";

import { ByteRing } from "@/lib/byteRing";

const bytes = (...n: number[]) => new Uint8Array(n);

describe("ByteRing", () => {
  it("buffers and drains in order", () => {
    const r = new ByteRing(100);
    r.push(bytes(1, 2, 3));
    r.push(bytes(4, 5));
    expect(r.length).toBe(5);
    expect(Array.from(r.takeAll())).toEqual([1, 2, 3, 4, 5]);
    expect(r.isEmpty()).toBe(true);
  });

  it("drops oldest whole chunks past the cap", () => {
    const r = new ByteRing(4);
    r.push(bytes(1, 2, 3)); // [123]
    r.push(bytes(4, 5)); // total 5 > 4 → drop [123] → [45]
    expect(Array.from(r.takeAll())).toEqual([4, 5]);
  });

  it("keeps only the tail of a single chunk larger than the cap", () => {
    const r = new ByteRing(3);
    r.push(bytes(1, 2, 3, 4, 5, 6, 7));
    expect(Array.from(r.takeAll())).toEqual([5, 6, 7]);
  });

  it("copies on push so a reused source buffer cannot corrupt it", () => {
    const r = new ByteRing(100);
    const src = bytes(9, 9);
    r.push(src);
    src[0] = 0; // mutate the source after pushing
    expect(Array.from(r.takeAll())).toEqual([9, 9]);
  });

  it("takeAll on an empty ring returns an empty array", () => {
    const r = new ByteRing(10);
    expect(r.takeAll().length).toBe(0);
    expect(r.isEmpty()).toBe(true);
  });

  it("ignores empty pushes", () => {
    const r = new ByteRing(10);
    r.push(new Uint8Array(0));
    expect(r.isEmpty()).toBe(true);
  });

  it("clear empties without draining", () => {
    const r = new ByteRing(10);
    r.push(bytes(1, 2));
    r.clear();
    expect(r.isEmpty()).toBe(true);
    expect(r.length).toBe(0);
  });
});
