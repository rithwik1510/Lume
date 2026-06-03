import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// vi.mock is hoisted above imports, so the mock fn must be created via
// vi.hoisted (a plain top-level const would be in the TDZ when the factory runs).
const { pasteFileToPane } = vi.hoisted(() => ({ pasteFileToPane: vi.fn() }));
vi.mock("@/lib/pasteFileToPane", () => ({ pasteFileToPane }));

import { beginInternalFileDrag } from "@/lib/internalFileDrag";
import { useDropTargetStore } from "@/store/dropTargetStore";

function paneEl(id: string): HTMLDivElement {
  const d = document.createElement("div");
  d.setAttribute("data-pane-id", id);
  document.body.appendChild(d);
  return d;
}

function mouse(type: string, x: number, y: number): void {
  window.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }));
}

describe("beginInternalFileDrag", () => {
  let origElementFromPoint: typeof document.elementFromPoint;

  beforeEach(() => {
    pasteFileToPane.mockClear();
    useDropTargetStore.getState().setDropTarget(null);
    origElementFromPoint = document.elementFromPoint;
  });
  afterEach(() => {
    document.elementFromPoint = origElementFromPoint;
    document.body.innerHTML = "";
  });

  it("pastes into the pane the pointer is released over (after moving past the threshold)", () => {
    const pane = paneEl("pane-2");
    document.elementFromPoint = vi.fn(() => pane);

    beginInternalFileDrag("C:\\proj\\a.ts", 0, 0);
    mouse("mousemove", 40, 40); // beyond threshold → dragging
    mouse("mouseup", 40, 40);

    expect(pasteFileToPane).toHaveBeenCalledWith("pane-2", "C:\\proj\\a.ts");
    expect(useDropTargetStore.getState().paneId).toBeNull(); // cleared after drop
  });

  it("does NOT paste on a click (pointer never moves past the threshold)", () => {
    const pane = paneEl("pane-2");
    document.elementFromPoint = vi.fn(() => pane);

    beginInternalFileDrag("C:\\proj\\a.ts", 10, 10);
    mouse("mousemove", 11, 11); // ~1.4px — below threshold
    mouse("mouseup", 11, 11);

    expect(pasteFileToPane).not.toHaveBeenCalled();
  });

  it("does not paste when released outside any pane", () => {
    document.elementFromPoint = vi.fn(() => document.body); // no data-pane-id ancestor

    beginInternalFileDrag("C:\\proj\\a.ts", 0, 0);
    mouse("mousemove", 40, 40);
    mouse("mouseup", 40, 40);

    expect(pasteFileToPane).not.toHaveBeenCalled();
  });
});
