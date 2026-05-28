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
import { leaf } from "@/store/layout/tree";

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

describe("sessionsStore — lifecycle", () => {
  beforeEach(() => {
    useSessionsStore.getState().reset();
    vi.useFakeTimers();
  });

  it("activateSession flips status, sets activeSessionId, bumps lastActiveAt, clears unread", () => {
    const id = useSessionsStore.getState().createSession("/p");
    useSessionsStore.setState((s) => {
      s.sessions[id].unread = true;
    });
    const beforeBump = useSessionsStore.getState().sessions[id].lastActiveAt;
    vi.advanceTimersByTime(50);
    useSessionsStore.getState().activateSession(id);
    const after = useSessionsStore.getState().sessions[id];
    expect(after.status).toBe("active");
    expect(after.unread).toBe(false);
    expect(after.lastActiveAt).toBeGreaterThan(beforeBump);
    expect(useSessionsStore.getState().activeSessionId).toBe(id);
  });

  it("activateSession is idempotent", () => {
    const id = useSessionsStore.getState().createSession("/p");
    useSessionsStore.getState().activateSession(id);
    useSessionsStore.getState().activateSession(id);
    expect(useSessionsStore.getState().activeSessionId).toBe(id);
    expect(useSessionsStore.getState().sessions[id].status).toBe("active");
  });

  it("stopSession flips status to stopped and clears activeSessionId if it matched", () => {
    const id = useSessionsStore.getState().createSession("/p");
    useSessionsStore.getState().activateSession(id);
    useSessionsStore.getState().stopSession(id);
    expect(useSessionsStore.getState().sessions[id].status).toBe("stopped");
    expect(useSessionsStore.getState().activeSessionId).toBeNull();
  });

  it("stopSession on a non-active session leaves activeSessionId untouched", () => {
    const a = useSessionsStore.getState().createSession("/p");
    const b = useSessionsStore.getState().createSession("/p");
    useSessionsStore.getState().activateSession(a);
    useSessionsStore.getState().stopSession(b);
    expect(useSessionsStore.getState().activeSessionId).toBe(a);
  });

  it("purgeSession removes the session entirely", () => {
    const id = useSessionsStore.getState().createSession("/p");
    useSessionsStore.getState().activateSession(id);
    useSessionsStore.getState().purgeSession(id);
    expect(useSessionsStore.getState().sessions[id]).toBeUndefined();
    expect(useSessionsStore.getState().activeSessionId).toBeNull();
  });

  it("purgeGroup removes every session whose folderPath matches", () => {
    const a = useSessionsStore.getState().createSession("/p1");
    const b = useSessionsStore.getState().createSession("/p1");
    const c = useSessionsStore.getState().createSession("/p2");
    useSessionsStore.getState().purgeGroup("/p1");
    expect(useSessionsStore.getState().sessions[a]).toBeUndefined();
    expect(useSessionsStore.getState().sessions[b]).toBeUndefined();
    expect(useSessionsStore.getState().sessions[c]).toBeDefined();
  });
});

describe("sessionsStore — metadata mutations", () => {
  beforeEach(() => useSessionsStore.getState().reset());

  it("renameSession updates name; empty reverts to default", () => {
    const id = useSessionsStore.getState().createSession("/p", "Original");
    useSessionsStore.getState().renameSession(id, "Renamed");
    expect(useSessionsStore.getState().sessions[id].name).toBe("Renamed");
    useSessionsStore.getState().renameSession(id, "");
    // Empty name falls back to "New session", sibling-suffixed against
    // existing siblings — there is only this session, so just "New session".
    expect(useSessionsStore.getState().sessions[id].name).toBe("New session");
  });

  it("setGroupLabel adds and removes entries", () => {
    useSessionsStore.getState().setGroupLabel("/p", "Pretty name");
    expect(useSessionsStore.getState().groupLabels["/p"]).toBe("Pretty name");
    useSessionsStore.getState().setGroupLabel("/p", "");
    expect(useSessionsStore.getState().groupLabels["/p"]).toBeUndefined();
  });

  it("toggleGroupCollapsed flips presence", () => {
    useSessionsStore.getState().toggleGroupCollapsed("/p");
    expect(useSessionsStore.getState().collapsedGroups).toContain("/p");
    useSessionsStore.getState().toggleGroupCollapsed("/p");
    expect(useSessionsStore.getState().collapsedGroups).not.toContain("/p");
  });

  it("bumpUnread sets true; no-op when session is active", () => {
    const id = useSessionsStore.getState().createSession("/p");
    useSessionsStore.getState().bumpUnread(id);
    expect(useSessionsStore.getState().sessions[id].unread).toBe(true);
    useSessionsStore.getState().clearUnread(id);
    expect(useSessionsStore.getState().sessions[id].unread).toBe(false);
    useSessionsStore.getState().activateSession(id);
    useSessionsStore.getState().bumpUnread(id);
    expect(useSessionsStore.getState().sessions[id].unread).toBe(false);
  });

  it("updateBranch sets gitBranch", () => {
    const id = useSessionsStore.getState().createSession("/p");
    useSessionsStore.getState().updateBranch(id, "main");
    expect(useSessionsStore.getState().sessions[id].gitBranch).toBe("main");
    useSessionsStore.getState().updateBranch(id, null);
    expect(useSessionsStore.getState().sessions[id].gitBranch).toBeNull();
  });
});

describe("sessionsStore — layout passthrough", () => {
  beforeEach(() => useSessionsStore.getState().reset());

  it("setLayoutRoot replaces a session's tree", () => {
    const id = useSessionsStore.getState().createSession("/p");
    const node = leaf("pane-1");
    useSessionsStore.getState().setLayoutRoot(id, node);
    expect(useSessionsStore.getState().sessions[id].layoutRoot).toBe(node);
  });

  it("setFocusedPane updates focusedPaneId", () => {
    const id = useSessionsStore.getState().createSession("/p");
    useSessionsStore.getState().setFocusedPane(id, "pane-7");
    expect(useSessionsStore.getState().sessions[id].focusedPaneId).toBe("pane-7");
  });

  it("toggleFileTree flips the per-session drawer state", () => {
    const id = useSessionsStore.getState().createSession("/p");
    expect(useSessionsStore.getState().sessions[id].fileTreeOpen).toBe(false);
    useSessionsStore.getState().toggleFileTree(id);
    expect(useSessionsStore.getState().sessions[id].fileTreeOpen).toBe(true);
    useSessionsStore.getState().toggleFileTree(id);
    expect(useSessionsStore.getState().sessions[id].fileTreeOpen).toBe(false);
  });
});
