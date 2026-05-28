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
