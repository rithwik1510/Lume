import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

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
import { leaf, leaf as makeLeaf, split } from "@/store/layout/tree";
import {
  sessionsForFolder,
  groupedSessions,
  findSessionForPane,
  getActivePaneIds,
  paneLaunchSpec,
  coerceRehydrated,
  remapSessionPaneIds,
  type Session,
} from "@/store/sessionsStore";

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
    expect(s.name).toBe("Session 1");
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

  afterEach(() => {
    // Restore real timers so later describes (and the file's outer suites)
    // don't inherit fake timers — would break any future Date.now()-based
    // assertion. Latent footgun caught in Phase 1 spec review.
    vi.useRealTimers();
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
    // Empty name falls back to the sequential default — only session in the
    // folder, so "Session 1".
    expect(useSessionsStore.getState().sessions[id].name).toBe("Session 1");
  });

  it("default names are sequential per folder: Session 1, 2, 3…", () => {
    const s = useSessionsStore.getState();
    const a = s.createSession("/p");
    const b = s.createSession("/p");
    const other = s.createSession("/q"); // different folder → its own sequence
    expect(useSessionsStore.getState().sessions[a].name).toBe("Session 1");
    expect(useSessionsStore.getState().sessions[b].name).toBe("Session 2");
    expect(useSessionsStore.getState().sessions[other].name).toBe("Session 1");
    // Deleting Session 1 doesn't recycle its number.
    useSessionsStore.getState().purgeSession(a);
    const c = useSessionsStore.getState().createSession("/p");
    expect(useSessionsStore.getState().sessions[c].name).toBe("Session 3");
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

describe("sessionsStore — selectors", () => {
  beforeEach(() => useSessionsStore.getState().reset());

  it("sessionsForFolder returns matches sorted by lastActiveAt desc", () => {
    const old = useSessionsStore.getState().createSession("/p", "A");
    const newer = useSessionsStore.getState().createSession("/p", "B");
    useSessionsStore.setState((s) => {
      s.sessions[newer].lastActiveAt = s.sessions[old].lastActiveAt + 1000;
    });
    const ids = sessionsForFolder(useSessionsStore.getState(), "/p").map((s) => s.id);
    expect(ids).toEqual([newer, old]);
  });

  it("groupedSessions buckets by folderPath, applies labels, respects collapsed", () => {
    const a1 = useSessionsStore.getState().createSession("/p1", "X");
    const a2 = useSessionsStore.getState().createSession("/p1", "Y");
    useSessionsStore.getState().createSession("/p2", "Z");
    useSessionsStore.getState().setGroupLabel("/p1", "Project One");
    useSessionsStore.getState().toggleGroupCollapsed("/p2");
    const groups = groupedSessions(useSessionsStore.getState());
    const g1 = groups.find((g) => g.folderPath === "/p1")!;
    const g2 = groups.find((g) => g.folderPath === "/p2")!;
    expect(g1.label).toBe("Project One");
    expect(g1.collapsed).toBe(false);
    expect(g1.sessions.map((s) => s.id).sort()).toEqual([a1, a2].sort());
    expect(g2.label).toBe("p2"); // basename fallback
    expect(g2.collapsed).toBe(true);
  });

  it("groupedSessions orders folders newest-first and never reshuffles on activation", () => {
    const a = useSessionsStore.getState().createSession("/older", "A");
    useSessionsStore.getState().createSession("/newer", "B");
    // Newest folder on top; activating the OLDER folder's session bumps its
    // lastActiveAt — folders must NOT reorder by recent use (point of the fix).
    useSessionsStore.getState().activateSession(a);
    const groups = groupedSessions(useSessionsStore.getState());
    expect(groups.map((g) => g.folderPath)).toEqual(["/newer", "/older"]);
  });

  it("groupedSessions orders sessions newest-first within a folder, stable under activation", () => {
    const first = useSessionsStore.getState().createSession("/p", "A");
    const second = useSessionsStore.getState().createSession("/p", "B");
    // Activating the OLDER session bumps its lastActiveAt; order must hold.
    useSessionsStore.getState().activateSession(first);
    const g = groupedSessions(useSessionsStore.getState()).find((x) => x.folderPath === "/p")!;
    expect(g.sessions.map((s) => s.id)).toEqual([second, first]);
  });

  it("findSessionForPane walks every layoutRoot", () => {
    const id = useSessionsStore.getState().createSession("/p");
    useSessionsStore.getState().setLayoutRoot(id, makeLeaf("pane-42"));
    expect(findSessionForPane(useSessionsStore.getState(), "pane-42")?.id).toBe(id);
    expect(findSessionForPane(useSessionsStore.getState(), "pane-nope")).toBeNull();
  });

  it("groupedSessions implicitly drops folderPaths whose only session was deleted (I4 guard)", () => {
    // I4: building groups during bucketing means a folderPath only appears
    // in `byFolder` if at least one session pushed to it. Deleting that
    // session removes it from state.sessions, so the bucket is never
    // created — and the now-empty folder cannot reach the sort comparator
    // with `Math.max(...[])` (which would silently return -Infinity).
    const a = useSessionsStore.getState().createSession("/p1", "A");
    useSessionsStore.getState().createSession("/p2", "B");
    // Delete the only session under /p1; /p1 must NOT appear in groups.
    useSessionsStore.getState().purgeSession(a);
    const groups = groupedSessions(useSessionsStore.getState());
    expect(groups.map((g) => g.folderPath)).toEqual(["/p2"]);
    // Synthetic worst case: hand-construct a SessionGroupView with empty
    // sessions through state injection — verify groupedSessions still
    // returns ordered output without -Infinity sorting artifacts.
    useSessionsStore.setState((s) => {
      s.groupLabels["/ghost"] = "Ghost"; // label without matching session
    });
    const groups2 = groupedSessions(useSessionsStore.getState());
    expect(groups2.map((g) => g.folderPath)).toEqual(["/p2"]);
  });

  it("App-bootstrap pattern is idempotent: re-running activates existing same-folder session (I3)", () => {
    // I3: simulates two back-to-back bootstrap effects (React Strict Mode
    // dev double-mount, or two quick launches). The expected behavior:
    // second pass finds the existing homeDir session via sessionsForFolder
    // and activates it instead of creating a duplicate.
    const home = "/home/me";
    const bootstrap = () => {
      const state = useSessionsStore.getState();
      const existing = sessionsForFolder(state, home);
      if (existing.length > 0) {
        state.activateSession(existing[0]!.id);
      } else {
        const id = state.createSession(home, "New session");
        state.activateSession(id);
      }
    };
    bootstrap();
    bootstrap();
    const all = Object.values(useSessionsStore.getState().sessions);
    expect(all.length).toBe(1);
    expect(all[0].folderPath).toBe(home);
    expect(useSessionsStore.getState().activeSessionId).toBe(all[0].id);
  });

  it("getActivePaneIds returns the union across active sessions", () => {
    const a = useSessionsStore.getState().createSession("/p");
    const b = useSessionsStore.getState().createSession("/q");
    useSessionsStore.getState().setLayoutRoot(a, makeLeaf("pane-1"));
    useSessionsStore.getState().setLayoutRoot(b, makeLeaf("pane-2"));
    // Only `a` is active → only pane-1 in union
    useSessionsStore.getState().activateSession(a);
    expect(getActivePaneIds(useSessionsStore.getState()).sort()).toEqual(["pane-1"]);
    // Mark `b` active too — both
    useSessionsStore.setState((s) => {
      s.sessions[b].status = "active";
    });
    expect(getActivePaneIds(useSessionsStore.getState()).sort()).toEqual(["pane-1", "pane-2"]);
  });
});

describe("sessionsStore — rehydration coercion", () => {
  it("coerces every session status to stopped, clears unread + activeSessionId", () => {
    const raw = {
      sessions: {
        a: {
          id: "a",
          name: "A",
          folderPath: "/p",
          layoutRoot: null,
          focusedPaneId: null,
          status: "active" as const,
          unread: true,
          working: true,
          gitBranch: "main",
          fileTreeOpen: true,
          createdAt: 1,
          lastActiveAt: 2,
        },
      },
      activeSessionId: "a",
      groupLabels: {},
      collapsedGroups: [],
    };
    const out = coerceRehydrated(raw);
    expect(out.sessions!.a.status).toBe("stopped");
    expect(out.sessions!.a.unread).toBe(false);
    expect(out.sessions!.a.working).toBe(false);
    expect(out.activeSessionId).toBeNull();
    // Durable fields survive untouched.
    expect(out.sessions!.a.gitBranch).toBe("main");
    expect(out.sessions!.a.fileTreeOpen).toBe(true);
  });

  it("remapSessionPaneIds de-collides paneIds shared across sessions", () => {
    const mk = (id: string, folderPath: string, paneId: string): Session => ({
      id,
      name: id,
      folderPath,
      layoutRoot: leaf(paneId),
      focusedPaneId: paneId,
      status: "stopped",
      unread: false,
      working: false,
      gitBranch: null,
      fileTreeOpen: false,
      createdAt: 1,
      lastActiveAt: 2,
    });
    // Two sessions from different launches both holding "pane-101" — the
    // collision that made findSessionForPane resolve the wrong folder.
    const sessions: Record<string, Session> = {
      home: mk("home", "/home", "pane-101"),
      proj: mk("proj", "/proj", "pane-101"),
    };
    remapSessionPaneIds(sessions);

    const homePane = (sessions.home.layoutRoot as { paneId: string }).paneId;
    const projPane = (sessions.proj.layoutRoot as { paneId: string }).paneId;
    expect(homePane).not.toBe(projPane); // de-collided
    // focusedPaneId remapped consistently with the leaf in the same session
    expect(sessions.home.focusedPaneId).toBe(homePane);
    expect(sessions.proj.focusedPaneId).toBe(projPane);
    // findSessionForPane now resolves each pane to its own session
    const state = { sessions } as unknown as Parameters<typeof findSessionForPane>[0];
    expect(findSessionForPane(state, homePane)?.id).toBe("home");
    expect(findSessionForPane(state, projPane)?.id).toBe("proj");
  });

  it("migrates legacy 'New session' names to sequential 'Session N' per folder", () => {
    const mk = (id: string, name: string, folderPath: string, createdAt: number): Session => ({
      id,
      name,
      folderPath,
      layoutRoot: null,
      focusedPaneId: null,
      status: "stopped",
      unread: false,
      working: false,
      gitBranch: null,
      fileTreeOpen: false,
      createdAt,
      lastActiveAt: createdAt,
    });
    const raw = {
      sessions: {
        // /proj already has a numbered sibling — migration continues from it.
        a: mk("a", "Session 1", "/proj", 1),
        b: mk("b", "New session", "/proj", 2),
        c: mk("c", "New session", "/proj", 3),
        // Other folder numbers independently; custom names are untouched.
        d: mk("d", "New session", "/other", 4),
        e: mk("e", "my agent", "/other", 5),
      },
      activeSessionId: null,
      groupLabels: {},
      collapsedGroups: [],
    };
    const out = coerceRehydrated(raw);
    expect(out.sessions!.a.name).toBe("Session 1");
    expect(out.sessions!.b.name).toBe("Session 2"); // older legacy first
    expect(out.sessions!.c.name).toBe("Session 3");
    expect(out.sessions!.d.name).toBe("Session 1");
    expect(out.sessions!.e.name).toBe("my agent");
  });

  it("drops groupLabels/collapsedGroups entries whose folderPath has no session", () => {
    const raw = {
      sessions: {
        a: {
          id: "a",
          name: "A",
          folderPath: "/live",
          layoutRoot: null,
          focusedPaneId: null,
          status: "stopped" as const,
          unread: false,
          working: false,
          gitBranch: null,
          fileTreeOpen: false,
          createdAt: 1,
          lastActiveAt: 2,
        },
      },
      activeSessionId: null,
      groupLabels: { "/live": "Live", "/orphan": "Orphan" },
      collapsedGroups: ["/live", "/orphan"],
    };
    const out = coerceRehydrated(raw);
    expect(out.groupLabels).toEqual({ "/live": "Live" });
    expect(out.collapsedGroups).toEqual(["/live"]);
  });
});

describe("sessionsStore — session restore (features A + B)", () => {
  beforeEach(() => useSessionsStore.getState().reset());

  it("activateSession records lastActiveSessionId", () => {
    const id = useSessionsStore.getState().createSession("/p");
    expect(useSessionsStore.getState().lastActiveSessionId).toBeNull();
    useSessionsStore.getState().activateSession(id);
    expect(useSessionsStore.getState().lastActiveSessionId).toBe(id);
  });

  it("purgeSession clears lastActiveSessionId when it matches", () => {
    const id = useSessionsStore.getState().createSession("/p");
    useSessionsStore.getState().activateSession(id);
    useSessionsStore.getState().purgeSession(id);
    expect(useSessionsStore.getState().lastActiveSessionId).toBeNull();
  });

  it("reopenLastSession defaults true; setReopenLastSession flips it", () => {
    expect(useSessionsStore.getState().reopenLastSession).toBe(true);
    useSessionsStore.getState().setReopenLastSession(false);
    expect(useSessionsStore.getState().reopenLastSession).toBe(false);
  });

  it("resumeSessions revives the whole fleet and focuses the last-active one", () => {
    const s = useSessionsStore.getState();
    const a = s.createSession("/a");
    const b = s.createSession("/b");
    const c = s.createSession("/c"); // was NOT running at exit

    useSessionsStore.getState().resumeSessions([a, b], b);
    const st = useSessionsStore.getState();
    expect(st.sessions[a].status).toBe("active");
    expect(st.sessions[b].status).toBe("active");
    expect(st.sessions[c].status).toBe("stopped");
    expect(st.activeSessionId).toBe(b);
    expect(st.lastActiveSessionId).toBe(b);
  });

  it("resumeSessions falls back to the first revivable id when activeId is stale", () => {
    const s = useSessionsStore.getState();
    const a = s.createSession("/a");
    useSessionsStore.getState().resumeSessions([a], "gone-id");
    expect(useSessionsStore.getState().activeSessionId).toBe(a);
  });

  it("coerceRehydrated keeps lastRunningSessionIds, dropping ids whose session is gone", () => {
    const raw = {
      sessions: {
        a: {
          id: "a",
          name: "Session 1",
          folderPath: "/p",
          layoutRoot: null,
          focusedPaneId: null,
          status: "stopped" as const,
          unread: false,
          working: false,
          gitBranch: null,
          fileTreeOpen: false,
          createdAt: 1,
          lastActiveAt: 2,
        },
      },
      activeSessionId: null,
      lastRunningSessionIds: ["a", "purged-id"],
      groupLabels: {},
      collapsedGroups: [],
    };
    const out = coerceRehydrated(raw);
    expect(out.lastRunningSessionIds).toEqual(["a"]);
  });

  it("setPaneShell writes the shell onto the matching (nested) leaf only", () => {
    const id = useSessionsStore.getState().createSession("/p");
    useSessionsStore
      .getState()
      .setLayoutRoot(id, split("horizontal", 0.5, leaf("pane-1"), leaf("pane-2")));
    const shell = { kind: "wsl", distro: "Ubuntu" } as const;
    useSessionsStore.getState().setPaneShell(id, "pane-2", shell);
    expect(paneLaunchSpec(useSessionsStore.getState(), "pane-2")?.shell).toEqual(shell);
    // sibling untouched
    expect(paneLaunchSpec(useSessionsStore.getState(), "pane-1")?.shell).toBeUndefined();
  });

  it("setPaneStartupCommand writes the command onto the matching leaf", () => {
    const id = useSessionsStore.getState().createSession("/p");
    useSessionsStore.getState().setLayoutRoot(id, makeLeaf("pane-1"));
    useSessionsStore.getState().setPaneStartupCommand(id, "pane-1", "claude");
    expect(paneLaunchSpec(useSessionsStore.getState(), "pane-1")?.startupCommand).toBe("claude");
  });

  it("paneLaunchSpec returns null for an unknown pane", () => {
    expect(paneLaunchSpec(useSessionsStore.getState(), "pane-nope")).toBeNull();
  });

  it("coerceRehydrated preserves lastActiveSessionId + reopenLastSession", () => {
    const raw = {
      sessions: {
        a: {
          id: "a",
          name: "A",
          folderPath: "/p",
          layoutRoot: makeLeaf("pane-1"),
          focusedPaneId: "pane-1",
          status: "active" as const,
          unread: false,
          working: false,
          gitBranch: null,
          fileTreeOpen: false,
          createdAt: 1,
          lastActiveAt: 2,
        },
      },
      activeSessionId: "a",
      lastActiveSessionId: "a",
      reopenLastSession: false,
      groupLabels: {},
      collapsedGroups: [],
    };
    const out = coerceRehydrated(raw);
    expect(out.activeSessionId).toBeNull(); // still all-stopped at rehydrate time
    expect(out.lastActiveSessionId).toBe("a"); // survives so boot can revive it
    expect(out.reopenLastSession).toBe(false);
  });

  it("coerceRehydrated drops a dangling lastActiveSessionId whose session is gone", () => {
    const out = coerceRehydrated({
      sessions: {},
      activeSessionId: null,
      lastActiveSessionId: "ghost",
      reopenLastSession: true,
      groupLabels: {},
      collapsedGroups: [],
    });
    expect(out.lastActiveSessionId).toBeNull();
  });

  it("coerceRehydrated defaults reopenLastSession to true when absent", () => {
    const out = coerceRehydrated({
      sessions: {},
      activeSessionId: null,
      groupLabels: {},
      collapsedGroups: [],
    });
    expect(out.reopenLastSession).toBe(true);
  });
});

describe("sessionsStore — split view", () => {
  beforeEach(() => {
    useSessionsStore.getState().reset();
  });

  function active(id: string) {
    useSessionsStore.getState().activateSession(id);
  }

  it("openSplitWith pairs the companion on the right and keeps focus on the active (left) session", () => {
    const a = useSessionsStore.getState().createSession("/p", "A");
    const b = useSessionsStore.getState().createSession("/p", "B");
    active(a);
    useSessionsStore.getState().openSplitWith(b);
    const s = useSessionsStore.getState();
    expect(s.splitView).toEqual([a, b]);
    expect(s.activeSessionId).toBe(a); // focus did NOT move to the companion
    expect(s.sessions[b].status).toBe("active"); // companion mounted
  });

  it("openSplitWith seeds a first pane for a never-opened companion so the slot isn't blank", () => {
    const a = useSessionsStore.getState().createSession("/p", "A");
    const b = useSessionsStore.getState().createSession("/p", "B");
    active(a);
    expect(useSessionsStore.getState().sessions[b].layoutRoot).toBeNull();
    useSessionsStore.getState().openSplitWith(b);
    const comp = useSessionsStore.getState().sessions[b];
    expect(comp.layoutRoot).not.toBeNull();
    expect(comp.focusedPaneId).not.toBeNull();
  });

  it("openSplitWith with no active session opens the companion full-screen (no split)", () => {
    const b = useSessionsStore.getState().createSession("/p", "B");
    useSessionsStore.getState().openSplitWith(b);
    const s = useSessionsStore.getState();
    expect(s.splitView).toBeNull();
    expect(s.activeSessionId).toBe(b);
    expect(s.sessions[b].status).toBe("active");
  });

  it("openSplitWith onto the active session is a no-op split (stays single)", () => {
    const a = useSessionsStore.getState().createSession("/p", "A");
    active(a);
    useSessionsStore.getState().openSplitWith(a);
    expect(useSessionsStore.getState().splitView).toBeNull();
  });

  it("openSplitWith replaces the right slot when a split is already open", () => {
    const a = useSessionsStore.getState().createSession("/p", "A");
    const b = useSessionsStore.getState().createSession("/p", "B");
    const c = useSessionsStore.getState().createSession("/p", "C");
    active(a);
    useSessionsStore.getState().openSplitWith(b);
    useSessionsStore.getState().openSplitWith(c);
    expect(useSessionsStore.getState().splitView).toEqual([a, c]);
  });

  it("closeSplit collapses to single view and keeps the removed session alive", () => {
    const a = useSessionsStore.getState().createSession("/p", "A");
    const b = useSessionsStore.getState().createSession("/p", "B");
    active(a);
    useSessionsStore.getState().openSplitWith(b);
    useSessionsStore.getState().closeSplit();
    const s = useSessionsStore.getState();
    expect(s.splitView).toBeNull();
    expect(s.activeSessionId).toBe(a);
    expect(s.sessions[b].status).toBe("active"); // not torn down — still a bg session
  });

  it("closeSplit moves focus to the left session when the right was focused", () => {
    const a = useSessionsStore.getState().createSession("/p", "A");
    const b = useSessionsStore.getState().createSession("/p", "B");
    active(a);
    useSessionsStore.getState().openSplitWith(b);
    active(b); // focus the right slot (still a member → split preserved)
    expect(useSessionsStore.getState().splitView).toEqual([a, b]);
    useSessionsStore.getState().closeSplit();
    expect(useSessionsStore.getState().activeSessionId).toBe(a);
  });

  it("activating a member moves the focus ring but keeps the split", () => {
    const a = useSessionsStore.getState().createSession("/p", "A");
    const b = useSessionsStore.getState().createSession("/p", "B");
    active(a);
    useSessionsStore.getState().openSplitWith(b);
    active(b);
    const s = useSessionsStore.getState();
    expect(s.splitView).toEqual([a, b]);
    expect(s.activeSessionId).toBe(b);
  });

  it("activating a non-member collapses the split", () => {
    const a = useSessionsStore.getState().createSession("/p", "A");
    const b = useSessionsStore.getState().createSession("/p", "B");
    const c = useSessionsStore.getState().createSession("/p", "C");
    active(a);
    useSessionsStore.getState().openSplitWith(b);
    active(c);
    expect(useSessionsStore.getState().splitView).toBeNull();
    expect(useSessionsStore.getState().activeSessionId).toBe(c);
  });

  it("stopSession on a split member collapses the split", () => {
    const a = useSessionsStore.getState().createSession("/p", "A");
    const b = useSessionsStore.getState().createSession("/p", "B");
    active(a);
    useSessionsStore.getState().openSplitWith(b);
    useSessionsStore.getState().stopSession(b);
    expect(useSessionsStore.getState().splitView).toBeNull();
  });

  it("purgeSession on a split member collapses the split", () => {
    const a = useSessionsStore.getState().createSession("/p", "A");
    const b = useSessionsStore.getState().createSession("/p", "B");
    active(a);
    useSessionsStore.getState().openSplitWith(b);
    useSessionsStore.getState().purgeSession(b);
    expect(useSessionsStore.getState().splitView).toBeNull();
  });

  it("coerceRehydrated always lands in single view (split is transient)", () => {
    const out = coerceRehydrated({
      sessions: {},
      activeSessionId: null,
      groupLabels: {},
      collapsedGroups: [],
    });
    expect(out.splitView).toBeNull();
  });
});
