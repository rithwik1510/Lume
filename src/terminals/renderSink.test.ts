import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/terminals/registry", () => ({ writeToTerminal: vi.fn() }));

import { ingest, foreground, forget, __resetSink } from "@/terminals/renderSink";
import { writeToTerminal } from "@/terminals/registry";
import { setVisiblePanes, __resetVisibility } from "@/terminals/visibility";

const b = (...n: number[]) => new Uint8Array(n);
const wrote = vi.mocked(writeToTerminal);
const writesFor = (paneId: string) =>
  wrote.mock.calls.filter((c) => c[0] === paneId).flatMap((c) => Array.from(c[1] as Uint8Array));

describe("renderSink", () => {
  beforeEach(() => {
    __resetSink();
    __resetVisibility();
    wrote.mockClear();
  });

  it("renders live when no pane is marked visible (fail-safe)", () => {
    ingest("p", b(1, 2, 3));
    expect(writesFor("p")).toEqual([1, 2, 3]);
  });

  it("renders a visible pane live", () => {
    setVisiblePanes(new Set(["p"]));
    ingest("p", b(1, 2));
    expect(writesFor("p")).toEqual([1, 2]);
  });

  it("buffers a hidden pane instead of writing to xterm", () => {
    setVisiblePanes(new Set(["other"])); // p is hidden
    ingest("p", b(1, 2, 3));
    expect(wrote).not.toHaveBeenCalledWith("p", expect.anything());
  });

  it("replays buffered output in order on foreground, before subsequent live bytes", () => {
    setVisiblePanes(new Set(["other"])); // p hidden
    ingest("p", b(1, 2));
    ingest("p", b(3));
    expect(wrote).not.toHaveBeenCalled();

    // Foreground p (governor marks it visible first, then calls foreground).
    setVisiblePanes(new Set(["p"]));
    foreground("p");
    expect(writesFor("p")).toEqual([1, 2, 3]); // the replay

    // A subsequent live chunk lands AFTER the replay.
    ingest("p", b(4, 5));
    expect(writesFor("p")).toEqual([1, 2, 3, 4, 5]);
  });

  it("foreground on a pane with no buffer is a no-op", () => {
    setVisiblePanes(new Set(["p"]));
    foreground("p");
    expect(wrote).not.toHaveBeenCalled();
  });

  it("drops the buffer on forget (no replay after kill)", () => {
    setVisiblePanes(new Set(["other"]));
    ingest("p", b(1, 2));
    forget("p");
    setVisiblePanes(new Set(["p"]));
    foreground("p");
    expect(wrote).not.toHaveBeenCalled();
  });
});
