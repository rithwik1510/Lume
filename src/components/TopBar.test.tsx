// src/components/TopBar.test.tsx
//
// Regression test for the data-tauri-drag-region invariant on the
// frameless titlebar. Every clickable control inside the titlebar must
// have data-tauri-drag-region="false" on its root, otherwise clicks
// register as window drags (DESIGN.md §5 + §12 W5 #1d).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { TopBar } from "@/components/TopBar";

// Hoisted mock fns — vi.mock is hoisted to the top of the file, so the
// factory closures below can't reach mocks declared with plain `const`.
// vi.hoisted() runs before any vi.mock factory and returns refs we can
// share between the factory and the test body.
const mocks = vi.hoisted(() => ({
  toggleSidebarMock: vi.fn(),
  setMdEditorModeMock: vi.fn(),
  splitPaneMock: vi.fn(),
  minimizeWindowMock: vi.fn(),
  toggleMaximizeMock: vi.fn(),
  closeWindowMock: vi.fn(),
}));

// Mock the Tauri window controls so the test runs in happy-dom.
vi.mock("@/lib/windowControls", () => ({
  minimizeWindow: mocks.minimizeWindowMock,
  toggleMaximize: mocks.toggleMaximizeMock,
  closeWindow: mocks.closeWindowMock,
  isMaximized: vi.fn(async () => false),
}));

vi.mock("@/lib/configClient", () => ({
  configFilePath: vi.fn(async () => "C:/fake/config.toml"),
}));

// Mock stores so the test doesn't depend on real layout/PTY state.
vi.mock("@/store/mdStore", () => ({
  useMdStore: Object.assign((sel: (s: unknown) => unknown) =>
    sel({
      mdEditorMode: "off",
      setMdEditorMode: mocks.setMdEditorModeMock,
      quickViewer: { open: false, path: null, content: "" },
      openMdInQuickViewer: vi.fn(),
      closeQuickViewer: vi.fn(),
      openMdTab: vi.fn(async () => undefined),
    }), { getState: vi.fn() }),
}));
vi.mock("@/store/sidebarStore", () => ({
  useSidebarStore: Object.assign((sel: (s: unknown) => unknown) =>
    sel({
      sidebarVisible: true,
      toggleSidebar: mocks.toggleSidebarMock,
      workspaceFolder: "C:/Users/test",
    }), { getState: vi.fn() }),
}));
vi.mock("@/store/layoutStore", () => ({
  useLayoutStore: Object.assign((sel: (s: unknown) => unknown) =>
    sel({
      focusedPaneId: "pane-1",
      splitPane: mocks.splitPaneMock,
    }), { getState: vi.fn() }),
}));

describe("TopBar — drag region invariant", () => {
  beforeEach(() => vi.clearAllMocks());

  it("every clickable control has data-tauri-drag-region=\"false\"", () => {
    const { container } = render(<TopBar />);
    const clickables = container.querySelectorAll("button, [role='button']");
    expect(clickables.length).toBeGreaterThanOrEqual(9); // 6 left + 3 right
    for (const el of Array.from(clickables)) {
      expect(
        el.getAttribute("data-tauri-drag-region"),
        `control ${el.outerHTML} is missing data-tauri-drag-region=\"false\"`
      ).toBe("false");
    }
  });
});

describe("TopBar — click handlers", () => {
  beforeEach(() => vi.clearAllMocks());

  it("clicking the Sidebar toggle calls toggleSidebar", () => {
    const { getByLabelText } = render(<TopBar />);
    fireEvent.click(getByLabelText("Toggle Sidebar"));
    expect(mocks.toggleSidebarMock).toHaveBeenCalledTimes(1);
  });

  it("clicking the MD Editor toggle (when off) calls setMdEditorMode with \"full\"", () => {
    const { getByLabelText } = render(<TopBar />);
    fireEvent.click(getByLabelText("Toggle MD Editor"));
    expect(mocks.setMdEditorModeMock).toHaveBeenCalledTimes(1);
    expect(mocks.setMdEditorModeMock).toHaveBeenCalledWith("full");
  });

  it("clicking the Split button calls splitPane with \"right\"", () => {
    const { getByLabelText } = render(<TopBar />);
    fireEvent.click(getByLabelText("Split right"));
    expect(mocks.splitPaneMock).toHaveBeenCalledTimes(1);
    expect(mocks.splitPaneMock.mock.calls[0][0]).toBe("right");
  });

  it("clicking Minimize calls minimizeWindow", () => {
    const { getByLabelText } = render(<TopBar />);
    fireEvent.click(getByLabelText("Minimize"));
    expect(mocks.minimizeWindowMock).toHaveBeenCalledTimes(1);
  });

  it("clicking Maximize calls toggleMaximize", () => {
    const { getByLabelText } = render(<TopBar />);
    fireEvent.click(getByLabelText("Maximize"));
    expect(mocks.toggleMaximizeMock).toHaveBeenCalledTimes(1);
  });

  it("clicking Close calls closeWindow", () => {
    const { getByLabelText } = render(<TopBar />);
    fireEvent.click(getByLabelText("Close"));
    expect(mocks.closeWindowMock).toHaveBeenCalledTimes(1);
  });
});
