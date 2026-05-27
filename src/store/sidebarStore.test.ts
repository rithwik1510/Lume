import { describe, expect, it, beforeEach, vi } from "vitest";

// The persist middleware loads from @tauri-apps/plugin-store on hydrate;
// mock it so the test runner doesn't try to call into Tauri at module load.
// `get` returns null so rehydrate is a no-op and stores keep their defaults.
vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: vi.fn(async () => null),
    set: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  })),
}));

import { useSidebarStore } from "@/store/sidebarStore";
import type { DirEntry } from "@/types/fs";

const fakeEntry = (name: string, isDir: boolean, parent: string): DirEntry => ({
  name,
  path: `${parent}/${name}`,
  is_dir: isDir,
  size: isDir ? 0 : 100,
  modified_ms: null,
});

describe("sidebarStore", () => {
  beforeEach(() => {
    useSidebarStore.getState().reset();
  });

  it("starts with no workspace and empty entries", () => {
    const s = useSidebarStore.getState();
    expect(s.workspaceFolder).toBeNull();
    expect(s.entries.size).toBe(0);
    expect(s.expanded.size).toBe(0);
  });

  it("setWorkspaceFolder records the path", () => {
    useSidebarStore.getState().setWorkspaceFolder("/home/u");
    expect(useSidebarStore.getState().workspaceFolder).toBe("/home/u");
  });

  it("storeEntries replaces the entries for a path", () => {
    const entries = [fakeEntry("a.md", false, "/home/u")];
    useSidebarStore.getState().storeEntries("/home/u", entries);
    expect(useSidebarStore.getState().entries.get("/home/u")).toEqual(entries);
  });

  it("toggleExpanded flips a path", () => {
    useSidebarStore.getState().toggleExpanded("/home/u/folder");
    expect(useSidebarStore.getState().expanded.has("/home/u/folder")).toBe(true);
    useSidebarStore.getState().toggleExpanded("/home/u/folder");
    expect(useSidebarStore.getState().expanded.has("/home/u/folder")).toBe(false);
  });

  it("setFilter records the lowercase filter text", () => {
    useSidebarStore.getState().setFilter("README");
    expect(useSidebarStore.getState().filterText).toBe("readme");
  });

  it("matchesFilter returns true for any entry when filter is empty", () => {
    useSidebarStore.getState().setFilter("");
    expect(useSidebarStore.getState().matchesFilter("anything.md")).toBe(true);
  });

  it("matchesFilter is case-insensitive substring", () => {
    useSidebarStore.getState().setFilter("read");
    expect(useSidebarStore.getState().matchesFilter("README.md")).toBe(true);
    expect(useSidebarStore.getState().matchesFilter("CHANGELOG.md")).toBe(false);
  });

  it("toggleSidebar flips visibility from true (default) to false to true", () => {
    const initial = useSidebarStore.getState().sidebarVisible;
    expect(initial).toBe(true);
    useSidebarStore.getState().toggleSidebar();
    expect(useSidebarStore.getState().sidebarVisible).toBe(false);
    useSidebarStore.getState().toggleSidebar();
    expect(useSidebarStore.getState().sidebarVisible).toBe(true);
  });

  it("setSidebarVisible sets the explicit value", () => {
    useSidebarStore.getState().setSidebarVisible(false);
    expect(useSidebarStore.getState().sidebarVisible).toBe(false);
    useSidebarStore.getState().setSidebarVisible(true);
    expect(useSidebarStore.getState().sidebarVisible).toBe(true);
  });
});
