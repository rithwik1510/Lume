// src/components/TopBar.test.tsx
//
// Regression test for the data-tauri-drag-region invariant on the
// frameless titlebar. Every clickable control inside the titlebar must
// have data-tauri-drag-region="false" on its root, otherwise clicks
// register as window drags (DESIGN.md §5 + §12 W5 #1d).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react"; // installed lazily below
import { TopBar } from "@/components/TopBar";

// Mock the Tauri window controls so the test runs in happy-dom.
vi.mock("@/lib/windowControls", () => ({
  minimizeWindow: vi.fn(),
  toggleMaximize: vi.fn(),
  closeWindow: vi.fn(),
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
      setMdEditorMode: vi.fn(),
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
      toggleSidebar: vi.fn(),
      workspaceFolder: "C:/Users/test",
    }), { getState: vi.fn() }),
}));
vi.mock("@/store/layoutStore", () => ({
  useLayoutStore: Object.assign((sel: (s: unknown) => unknown) =>
    sel({
      focusedPaneId: "pane-1",
      splitPane: vi.fn(),
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
