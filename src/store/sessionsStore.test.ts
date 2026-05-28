import { describe, it, expect, beforeEach, vi } from "vitest";

// @tauri-apps/plugin-store mock is required because sessionsStore uses
// persist middleware via tauriPersistStorage. Mirrors mdStore.test.ts.
vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: vi.fn(async () => null),
    set: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    save: vi.fn(async () => undefined),
  })),
}));

import { useSessionsStore } from "@/store/sessionsStore";

describe("sessionsStore — initial state", () => {
  beforeEach(() => {
    useSessionsStore.getState().reset();
  });

  it("starts with empty sessions, null active, empty grouping state", () => {
    const s = useSessionsStore.getState();
    expect(s.sessions).toEqual({});
    expect(s.activeSessionId).toBeNull();
    expect(s.groupLabels).toEqual({});
    expect(s.collapsedGroups).toEqual([]);
  });

  it("reset returns to the initial state from any modified state", () => {
    // Pre-populate
    useSessionsStore.setState((draft) => {
      // @ts-expect-error — testing reset, fine to break invariants temporarily
      draft.sessions["x"] = { id: "x" };
      draft.activeSessionId = "x";
      draft.groupLabels["/foo"] = "Foo";
      draft.collapsedGroups.push("/foo");
    });
    useSessionsStore.getState().reset();
    const s = useSessionsStore.getState();
    expect(s.sessions).toEqual({});
    expect(s.activeSessionId).toBeNull();
    expect(s.groupLabels).toEqual({});
    expect(s.collapsedGroups).toEqual([]);
  });
});

describe("sessionsStore — createSession", () => {
  beforeEach(() => {
    useSessionsStore.getState().reset();
  });

  it("creates a session with stopped status, defaulted name, and ISO timestamps", () => {
    const before = Date.now();
    const id = useSessionsStore.getState().createSession("/home/me/project");
    const s = useSessionsStore.getState().sessions[id];
    expect(s.folderPath).toBe("/home/me/project");
    expect(s.name).toBe("New session");
    expect(s.status).toBe("stopped");
    expect(s.unread).toBe(false);
    expect(s.layoutRoot).toBeNull();
    expect(s.focusedPaneId).toBeNull();
    expect(s.gitBranch).toBeNull();
    expect(s.fileTreeOpen).toBe(false);
    expect(s.createdAt).toBeGreaterThanOrEqual(before);
    expect(s.lastActiveAt).toBeGreaterThanOrEqual(before);
  });

  it("uses the provided name as-is when no sibling collision", () => {
    const id = useSessionsStore.getState().createSession("/p", "Custom name");
    expect(useSessionsStore.getState().sessions[id].name).toBe("Custom name");
  });

  it("auto-suffixes when a sibling under the SAME folder already has that name", () => {
    const a = useSessionsStore.getState().createSession("/p", "Work");
    const b = useSessionsStore.getState().createSession("/p", "Work");
    expect(useSessionsStore.getState().sessions[a].name).toBe("Work");
    expect(useSessionsStore.getState().sessions[b].name).toBe("Work-2");
  });

  it("does NOT auto-suffix when the colliding name is in a DIFFERENT folder", () => {
    useSessionsStore.getState().createSession("/p1", "Work");
    const id2 = useSessionsStore.getState().createSession("/p2", "Work");
    expect(useSessionsStore.getState().sessions[id2].name).toBe("Work");
  });

  it("returns a fresh UUID-style id every call", () => {
    const a = useSessionsStore.getState().createSession("/p");
    const b = useSessionsStore.getState().createSession("/p");
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(8);
  });
});
