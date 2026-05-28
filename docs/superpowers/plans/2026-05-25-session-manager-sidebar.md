# Session Manager Sidebar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the file-tree sidebar with a cmux-style session manager — a grouped tree of named, persistent workspaces (one group per folder, sessions nested inside), with live background PTYs across session-switch and stop-but-remember close semantics.

**Architecture:**
- New `sessionsStore` is the source of truth for all sessions, grouping state, and active-session selection.
- `layoutStore` becomes a thin façade that delegates every action to the active session's `layoutRoot` — existing PaneTree / shortcut / status-bar code keeps working unchanged at call sites.
- Orchestrator subscribes to the **union of paneIds across all `status === "active"` sessions** (not just the active one), so background-session PTYs survive session-switch and only die on `stopSession`.
- Main area renders one `<PaneTree>` per active session, gating visibility with `display: none` on inactive ones — xterm Terminals stay attached to host divs across switches.

**Tech Stack:** Zustand (devtools + immer + persist), React, xterm.js, Tauri v2, Rust (`portable-pty` already wired), CSS modules, vitest.

**Reference spec:** `docs/superpowers/specs/2026-05-25-session-manager-sidebar.md`

**Cadence:** Phases ship in order. Phase 3 is split into 3a / 3b / 3c so we get a code-review gate roughly every 4-6 tasks (per user preference). Each phase ends with a code-review gate before moving on.

---

## Pre-Phase: Spec correction

The spec §8.2 says ☰ becomes the file-tree toggle. But ☰ today already toggles the *sidebar* (Ctrl+B). The most coherent mapping in the new world is: ☰ continues to toggle the *sessions* sidebar (it's still "the sidebar"), and the file-tree drawer gets a NEW dedicated toggle button. This task fixes the spec text to match what the plan implements.

### Task P0: Spec correction — file tree toggle is a new button, not ☰

**Files:**
- Modify: `docs/superpowers/specs/2026-05-25-session-manager-sidebar.md`

- [ ] **Step 1: Update §8.2 to say file tree gets a NEW topbar button**

In §8.2, replace:

```markdown
- The existing `☰` button in the topbar's left cluster (currently no-op) becomes the file tree toggle. Reads/writes `sessions[activeId].fileTreeOpen`.
- Active state highlight (accent border) when drawer is open.
```

with:

```markdown
- `☰` continues to toggle the sessions sidebar (Ctrl+B), unchanged from v0.1.
- A NEW topbar button (between `☰` and `⊞` in the left cluster) toggles the file tree drawer. Icon: 🗂 (folder-with-tab). Reads/writes `sessions[activeId].fileTreeOpen` via `toggleFileTree(activeId)`.
- Active state highlight (accent border) when drawer is open.
- Shortcut: `Ctrl+Shift+E` (mirrors VS Code's "Explorer toggle").
```

Also update §13 shortcuts table to add the `Ctrl+Shift+E` row.

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/specs/2026-05-25-session-manager-sidebar.md
git commit -m "docs(spec): file tree gets new topbar button, not ☰"
```

---

## Phase 1: Foundation — `sessionsStore` + orchestrator + `layoutStore` façade

**Goal:** Build the data layer. After this phase, the existing UI looks identical, but every layout operation flows through the new sessionsStore via the façade. No visual changes yet — but the test suite proves the model is sound.

**Files created:**
- `src/store/sessionsStore.ts` — the new store
- `src/store/sessionsStore.test.ts` — vitest unit tests
- `src/lib/sessions/groupingHelpers.ts` — pure helpers for grouping / name auto-suffix

**Files modified:**
- `src/store/layoutStore.ts` — rewritten as façade over sessionsStore
- `src/terminals/orchestrator.ts` — subscribes to active-paneIds union from sessionsStore

### Task 1.1: Define types + empty state + reset (TDD)

**Files:**
- Create: `src/store/sessionsStore.ts`
- Create: `src/store/sessionsStore.test.ts`

- [ ] **Step 1: Write failing test for empty initial state and reset**

Create `src/store/sessionsStore.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test -- sessionsStore`
Expected: FAIL — `useSessionsStore` not exported.

- [ ] **Step 3: Create the store with types and empty state**

Create `src/store/sessionsStore.ts`:

```typescript
// sessionsStore — multi-named-per-folder sessions, source of truth for the
// session manager sidebar. See docs/superpowers/specs/2026-05-25-session-
// manager-sidebar.md §4 for the data model and §11 for the persistence
// contract.
//
// Lifecycle invariants:
//   - status is NEVER persisted; rehydration coerces every session to "stopped"
//   - activeSessionId is NEVER persisted; cold start = null (all-stopped)
//   - unread is transient; cleared on activate
//   - PTY processes don't survive restart (DESIGN.md §1 invariant 5)
//
// Grouping is derived: every distinct folderPath across `sessions` forms a
// group. No separate Group entity — just label overrides and collapsed-state,
// keyed by folderPath.

import { create } from "zustand";
import { devtools, persist, createJSONStorage } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

import type { LayoutNode } from "@/store/layout/tree";
import type { PaneId } from "@/types";
import { tauriPersistStorage } from "@/lib/persistStorage";

export type SessionId = string;
export type SessionStatus = "active" | "stopped";

export interface Session {
  id: SessionId;
  name: string;
  folderPath: string;
  layoutRoot: LayoutNode | null;
  focusedPaneId: PaneId | null;
  status: SessionStatus;
  unread: boolean;
  gitBranch: string | null;
  fileTreeOpen: boolean;
  createdAt: number;
  lastActiveAt: number;
}

export interface SessionsState {
  sessions: Record<SessionId, Session>;
  activeSessionId: SessionId | null;
  groupLabels: Record<string, string>;
  collapsedGroups: string[];

  // Actions — implemented in subsequent tasks
  reset: () => void;
}

const emptyState = () => ({
  sessions: {},
  activeSessionId: null,
  groupLabels: {},
  collapsedGroups: [],
});

export const useSessionsStore = create<SessionsState>()(
  devtools(
    persist(
      immer((set) => ({
        ...emptyState(),
        reset: () =>
          set((s) => {
            s.sessions = {};
            s.activeSessionId = null;
            s.groupLabels = {};
            s.collapsedGroups = [];
          }),
      })),
      {
        name: "sessions",
        storage: createJSONStorage(() => tauriPersistStorage("workstation-store.json")),
        version: 1,
        // Partializer + rehydration filled in Phase 8. For now persist nothing
        // so tests run against a clean slate.
        partialize: () => ({}),
      }
    ),
    { name: "sessionsStore" }
  )
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test -- sessionsStore`
Expected: PASS — both initial-state tests green.

- [ ] **Step 5: Commit**

```bash
git add src/store/sessionsStore.ts src/store/sessionsStore.test.ts
git commit -m "feat(sessions): scaffold sessionsStore with empty state + reset"
```

### Task 1.2: `createSession` with sibling-scoped name auto-suffix

**Files:**
- Create: `src/lib/sessions/groupingHelpers.ts`
- Create: `src/lib/sessions/groupingHelpers.test.ts`
- Modify: `src/store/sessionsStore.ts`
- Modify: `src/store/sessionsStore.test.ts`

- [ ] **Step 1: Write failing tests for helpers**

Create `src/lib/sessions/groupingHelpers.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { basename, autoSuffixSessionName, samePath } from "@/lib/sessions/groupingHelpers";

describe("basename", () => {
  it("returns the last segment for posix paths", () => {
    expect(basename("/home/user/project")).toBe("project");
    expect(basename("/home/user/project/")).toBe("project");
  });
  it("returns the last segment for windows paths", () => {
    expect(basename("C:\\Users\\posan\\repo")).toBe("repo");
    expect(basename("C:\\Users\\posan\\repo\\")).toBe("repo");
  });
  it("returns empty string for empty input", () => {
    expect(basename("")).toBe("");
  });
});

describe("samePath", () => {
  it("compares posix paths exactly", () => {
    expect(samePath("/a/b", "/a/b")).toBe(true);
    expect(samePath("/a/b", "/a/c")).toBe(false);
  });
  it("compares windows paths case-insensitively", () => {
    expect(samePath("C:\\Users\\Posan", "c:\\users\\posan")).toBe(true);
  });
  it("normalises trailing slash", () => {
    expect(samePath("/a/b/", "/a/b")).toBe(true);
  });
});

describe("autoSuffixSessionName", () => {
  it("returns the desired name when no collision", () => {
    expect(autoSuffixSessionName("foo", ["bar", "baz"])).toBe("foo");
  });
  it("appends -2 on first collision", () => {
    expect(autoSuffixSessionName("foo", ["foo"])).toBe("foo-2");
  });
  it("walks the suffix until free", () => {
    expect(autoSuffixSessionName("foo", ["foo", "foo-2", "foo-3"])).toBe("foo-4");
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm run test -- groupingHelpers`
Expected: FAIL — helpers not found.

- [ ] **Step 3: Implement helpers**

Create `src/lib/sessions/groupingHelpers.ts`:

```typescript
// Pure helpers for sessionsStore grouping. Kept out of the store file
// because they're trivially unit-testable without Zustand machinery.

/** Last path segment. Handles both forward and back slashes; trims trailing separators. */
export function basename(path: string): string {
  if (path === "") return "";
  const trimmed = path.replace(/[/\\]+$/, "");
  const idx = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

/**
 * Path equality with platform-appropriate semantics:
 *   - On Windows the comparison is case-insensitive (path components compare as
 *     equal regardless of case).
 *   - Trailing slashes are stripped before comparison so "/a/b" === "/a/b/".
 */
export function samePath(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/[/\\]+$/, "");
  const A = norm(a);
  const B = norm(b);
  // Windows detection: path starts with a drive letter or contains backslash.
  const isWin = /^[a-zA-Z]:[\\/]/.test(A) || A.includes("\\") || B.includes("\\");
  return isWin ? A.toLowerCase() === B.toLowerCase() : A === B;
}

/**
 * Given a desired name and the existing sibling names, return either the
 * desired name (if unused) or `name-2`, `name-3`, ... up to the first free.
 */
export function autoSuffixSessionName(desired: string, taken: string[]): string {
  if (!taken.includes(desired)) return desired;
  let i = 2;
  while (taken.includes(`${desired}-${i}`)) i++;
  return `${desired}-${i}`;
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm run test -- groupingHelpers`
Expected: PASS — all 8 tests green.

- [ ] **Step 5: Write failing test for `createSession`**

Append to `src/store/sessionsStore.test.ts`:

```typescript
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
```

- [ ] **Step 6: Run tests, verify they fail**

Run: `npm run test -- sessionsStore`
Expected: FAIL — `createSession` undefined.

- [ ] **Step 7: Implement `createSession`**

Modify `src/store/sessionsStore.ts`:

```typescript
// Add to imports:
import { autoSuffixSessionName, basename, samePath } from "@/lib/sessions/groupingHelpers";

// Add to SessionsState interface (replacing the lone `reset`):
//   createSession: (folderPath: string, name?: string) => SessionId;
//   reset: () => void;

// Inside `create(...)`'s store-builder, replace the body to include createSession:

  createSession: (folderPath, name) => {
    const id = crypto.randomUUID();
    const now = Date.now();
    const siblingNames = Object.values(get().sessions)
      .filter((s) => samePath(s.folderPath, folderPath))
      .map((s) => s.name);
    const desired = name ?? "New session";
    const finalName = autoSuffixSessionName(desired, siblingNames);
    set((s) => {
      s.sessions[id] = {
        id,
        name: finalName,
        folderPath,
        layoutRoot: null,
        focusedPaneId: null,
        status: "stopped",
        unread: false,
        gitBranch: null,
        fileTreeOpen: false,
        createdAt: now,
        lastActiveAt: now,
      };
    });
    return id;
  },
```

Note: this requires `(set, get)` signature in `immer((set, get) => ({ ... }))` — update the builder accordingly.

Also update the `SessionsState` interface to declare `createSession`.

- [ ] **Step 8: Run tests, verify pass**

Run: `npm run test -- sessionsStore`
Expected: PASS — all five new tests + the two initial-state tests green.

- [ ] **Step 9: Commit**

```bash
git add src/lib/sessions/groupingHelpers.ts src/lib/sessions/groupingHelpers.test.ts src/store/sessionsStore.ts src/store/sessionsStore.test.ts
git commit -m "feat(sessions): createSession with sibling-scoped name suffix"
```

### Task 1.3: `activateSession`, `stopSession`, `purgeSession`, `purgeGroup`

**Files:**
- Modify: `src/store/sessionsStore.ts`
- Modify: `src/store/sessionsStore.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `src/store/sessionsStore.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm run test -- sessionsStore`
Expected: FAIL — actions undefined.

- [ ] **Step 3: Implement the actions**

In `src/store/sessionsStore.ts`, extend `SessionsState` and the store-builder body. Add to the actions block:

```typescript
  activateSession: (id) =>
    set((s) => {
      const session = s.sessions[id];
      if (!session) return;
      session.status = "active";
      session.unread = false;
      session.lastActiveAt = Date.now();
      s.activeSessionId = id;
    }),

  stopSession: (id) =>
    set((s) => {
      const session = s.sessions[id];
      if (!session) return;
      session.status = "stopped";
      if (s.activeSessionId === id) s.activeSessionId = null;
    }),

  purgeSession: (id) =>
    set((s) => {
      if (!s.sessions[id]) return;
      delete s.sessions[id];
      if (s.activeSessionId === id) s.activeSessionId = null;
    }),

  purgeGroup: (folderPath) =>
    set((s) => {
      for (const id of Object.keys(s.sessions)) {
        if (samePath(s.sessions[id].folderPath, folderPath)) {
          delete s.sessions[id];
          if (s.activeSessionId === id) s.activeSessionId = null;
        }
      }
    }),
```

Also declare the four new methods in `SessionsState`:

```typescript
  activateSession: (id: SessionId) => void;
  stopSession: (id: SessionId) => void;
  purgeSession: (id: SessionId) => void;
  purgeGroup: (folderPath: string) => void;
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm run test -- sessionsStore`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/sessionsStore.ts src/store/sessionsStore.test.ts
git commit -m "feat(sessions): activate/stop/purge session + purgeGroup"
```

### Task 1.4: `renameSession`, `setGroupLabel`, `toggleGroupCollapsed`, `clearUnread`, `bumpUnread`, `updateBranch`

**Files:**
- Modify: `src/store/sessionsStore.ts`
- Modify: `src/store/sessionsStore.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `src/store/sessionsStore.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm run test -- sessionsStore`
Expected: FAIL.

- [ ] **Step 3: Implement the mutators**

Add to the store-builder:

```typescript
  renameSession: (id, name) =>
    set((s) => {
      const session = s.sessions[id];
      if (!session) return;
      if (name === "") {
        // Revert to default, sibling-suffixed
        const siblings = Object.values(s.sessions)
          .filter((x) => x.id !== id && samePath(x.folderPath, session.folderPath))
          .map((x) => x.name);
        session.name = autoSuffixSessionName("New session", siblings);
      } else {
        session.name = name;
      }
    }),

  setGroupLabel: (folderPath, label) =>
    set((s) => {
      if (label === "") delete s.groupLabels[folderPath];
      else s.groupLabels[folderPath] = label;
    }),

  toggleGroupCollapsed: (folderPath) =>
    set((s) => {
      const idx = s.collapsedGroups.indexOf(folderPath);
      if (idx >= 0) s.collapsedGroups.splice(idx, 1);
      else s.collapsedGroups.push(folderPath);
    }),

  bumpUnread: (id) =>
    set((s) => {
      const session = s.sessions[id];
      if (!session) return;
      if (s.activeSessionId === id) return;
      session.unread = true;
    }),

  clearUnread: (id) =>
    set((s) => {
      const session = s.sessions[id];
      if (session) session.unread = false;
    }),

  updateBranch: (id, branch) =>
    set((s) => {
      const session = s.sessions[id];
      if (session) session.gitBranch = branch;
    }),
```

Declare each in `SessionsState`.

- [ ] **Step 4: Run tests, verify pass**

Run: `npm run test -- sessionsStore`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/sessionsStore.ts src/store/sessionsStore.test.ts
git commit -m "feat(sessions): rename + groupLabel + collapse + unread + branch"
```

### Task 1.5: `setLayoutRoot`, `setFocusedPane`, `toggleFileTree`

**Files:**
- Modify: `src/store/sessionsStore.ts`
- Modify: `src/store/sessionsStore.test.ts`

- [ ] **Step 1: Write failing tests**

Append:

```typescript
import { leaf } from "@/store/layout/tree";

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
```

- [ ] **Step 2: Verify failure**

Run: `npm run test -- sessionsStore`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add to the store-builder:

```typescript
  setLayoutRoot: (id, root) =>
    set((s) => {
      const session = s.sessions[id];
      if (session) session.layoutRoot = root;
    }),

  setFocusedPane: (id, paneId) =>
    set((s) => {
      const session = s.sessions[id];
      if (session) session.focusedPaneId = paneId;
    }),

  toggleFileTree: (id) =>
    set((s) => {
      const session = s.sessions[id];
      if (session) session.fileTreeOpen = !session.fileTreeOpen;
    }),
```

Declare in `SessionsState`:

```typescript
  setLayoutRoot: (id: SessionId, root: LayoutNode | null) => void;
  setFocusedPane: (id: SessionId, paneId: PaneId | null) => void;
  toggleFileTree: (id: SessionId) => void;
```

- [ ] **Step 4: Verify pass**

Run: `npm run test -- sessionsStore`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/sessionsStore.ts src/store/sessionsStore.test.ts
git commit -m "feat(sessions): layout passthrough mutations"
```

### Task 1.6: Selectors — `sessionsForFolder`, `groupedSessions`, `findSessionForPane`, `getActivePaneIds`

**Files:**
- Modify: `src/store/sessionsStore.ts`
- Modify: `src/store/sessionsStore.test.ts`

- [ ] **Step 1: Write failing tests**

Append:

```typescript
import { leaves as treeLeaves, leaf as makeLeaf, splitPane as splitOp } from "@/store/layout/tree";
import { sessionsForFolder, groupedSessions, findSessionForPane, getActivePaneIds } from "@/store/sessionsStore";

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

  it("groupedSessions sorts groups by max child lastActiveAt desc", () => {
    const a = useSessionsStore.getState().createSession("/older", "A");
    const b = useSessionsStore.getState().createSession("/newer", "B");
    useSessionsStore.setState((s) => {
      s.sessions[b].lastActiveAt = s.sessions[a].lastActiveAt + 1000;
    });
    const groups = groupedSessions(useSessionsStore.getState());
    expect(groups[0].folderPath).toBe("/newer");
    expect(groups[1].folderPath).toBe("/older");
  });

  it("findSessionForPane walks every layoutRoot", () => {
    const id = useSessionsStore.getState().createSession("/p");
    useSessionsStore.getState().setLayoutRoot(id, makeLeaf("pane-42"));
    expect(findSessionForPane(useSessionsStore.getState(), "pane-42")?.id).toBe(id);
    expect(findSessionForPane(useSessionsStore.getState(), "pane-nope")).toBeNull();
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
```

- [ ] **Step 2: Verify failure**

Run: `npm run test -- sessionsStore`
Expected: FAIL.

- [ ] **Step 3: Implement selectors as top-level functions**

Add to `src/store/sessionsStore.ts` (export from module, not on the store):

```typescript
import { leaves as treeLeaves } from "@/store/layout/tree";

export function sessionsForFolder(state: SessionsState, folderPath: string): Session[] {
  return Object.values(state.sessions)
    .filter((s) => samePath(s.folderPath, folderPath))
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt);
}

export interface SessionGroupView {
  folderPath: string;
  label: string;          // groupLabels[folderPath] ?? basename(folderPath)
  collapsed: boolean;
  sessions: Session[];    // sorted by lastActiveAt desc
}

export function groupedSessions(state: SessionsState): SessionGroupView[] {
  // Bucket by exact folderPath (string identity, no normalization beyond
  // what's already stored). Same-folder dedup is handled by samePath where
  // it matters; this is the render-input grouping.
  const byFolder: Record<string, Session[]> = {};
  for (const s of Object.values(state.sessions)) {
    (byFolder[s.folderPath] ??= []).push(s);
  }
  const groups: SessionGroupView[] = Object.entries(byFolder).map(([folderPath, sessions]) => ({
    folderPath,
    label: state.groupLabels[folderPath] ?? basename(folderPath),
    collapsed: state.collapsedGroups.includes(folderPath),
    sessions: sessions.sort((a, b) => b.lastActiveAt - a.lastActiveAt),
  }));
  // Sort groups by their max-child lastActiveAt desc.
  groups.sort((a, b) => {
    const ax = Math.max(...a.sessions.map((s) => s.lastActiveAt));
    const bx = Math.max(...b.sessions.map((s) => s.lastActiveAt));
    return bx - ax;
  });
  return groups;
}

export function findSessionForPane(state: SessionsState, paneId: PaneId): Session | null {
  for (const s of Object.values(state.sessions)) {
    if (s.layoutRoot && treeLeaves(s.layoutRoot).includes(paneId)) return s;
  }
  return null;
}

/** Union of paneIds across every active session. Used by the orchestrator. */
export function getActivePaneIds(state: SessionsState): PaneId[] {
  const out: PaneId[] = [];
  for (const s of Object.values(state.sessions)) {
    if (s.status !== "active" || !s.layoutRoot) continue;
    out.push(...treeLeaves(s.layoutRoot));
  }
  return out;
}
```

- [ ] **Step 4: Verify pass**

Run: `npm run test -- sessionsStore`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store/sessionsStore.ts src/store/sessionsStore.test.ts
git commit -m "feat(sessions): selectors — sessionsForFolder, groupedSessions, findSessionForPane, getActivePaneIds"
```

### Task 1.7: `layoutStore` rewrite as façade

**Files:**
- Modify: `src/store/layoutStore.ts`
- Read for context: `src/store/layoutStore.ts` (current full content)
- Read for context: `src/store/layout/tree.ts`

- [ ] **Step 1: Read the current layoutStore to understand call sites**

```bash
cat src/store/layoutStore.ts | head -120
```

Note: every action operates on `state.root` and `state.focusedPaneId`. The façade keeps the same external API but redirects writes to `sessionsStore.sessions[activeId]`.

- [ ] **Step 2: Rewrite `layoutStore.ts` to be a façade**

Replace the body of `src/store/layoutStore.ts`:

```typescript
// layoutStore — Façade over sessionsStore (Phase 1 of session manager).
//
// Every consumer (PaneTree, useKeyboardShortcuts, orchestrator, StatusBar)
// still imports useLayoutStore and calls splitPane / closePane / focusPane /
// resizeSplit / moveFocus / focusedPaneId / root just like before. Those
// reads and writes are routed through sessionsStore.sessions[activeId].
//
// When activeSessionId is null (cold start, all-stopped), reads return null
// and writes are no-ops.
//
// This file used to OWN the layout tree directly (W2). The data lives in
// sessionsStore now; this file is a compatibility shim so we didn't have to
// rewrite every consumer in one PR.

import { create } from "zustand";
import { devtools } from "zustand/middleware";

import type { PaneId } from "@/types";
import {
  type LayoutNode,
  type SplitDirection,
  type FocusDirection,
  contains,
  splitPane as splitPaneOp,
  closePane as closePaneOp,
  resizeSplit as resizeSplitOp,
  moveFocus as moveFocusOp,
  leaf,
  leaves,
  clampRatio,
} from "./layout/tree";
import { useSessionsStore } from "@/store/sessionsStore";

interface LayoutState {
  // No fields. Subscribers re-render when the underlying sessionsStore changes.
  // We expose `root` and `focusedPaneId` as bound getters (selectors).
}

interface LayoutActions {
  initWithFirstPane: (paneId: PaneId) => void;
  splitPane: (direction: SplitDirection, newPaneId: PaneId, targetId?: PaneId) => void;
  closePane: (paneId: PaneId) => void;
  focusPane: (paneId: PaneId) => void;
  moveFocus: (direction: FocusDirection) => void;
  resizeSplit: (a: PaneId, b: PaneId, ratio: number) => void;
  reset: () => void;
}

type LayoutStore = LayoutState & LayoutActions;

// ─── Façade helpers ────────────────────────────────────────────────────────

function activeId(): string | null {
  return useSessionsStore.getState().activeSessionId;
}

function activeSession() {
  const s = useSessionsStore.getState();
  const id = s.activeSessionId;
  return id ? s.sessions[id] : null;
}

/** Read-only selector for the active session's root. Subscribes via Zustand. */
export function selectActiveRoot(): LayoutNode | null {
  return activeSession()?.layoutRoot ?? null;
}

/** Read-only selector for the active session's focused pane. */
export function selectActiveFocusedPaneId(): PaneId | null {
  return activeSession()?.focusedPaneId ?? null;
}

// ─── Store ────────────────────────────────────────────────────────────────

export const useLayoutStore = create<LayoutStore>()(
  devtools(
    (set, get) => ({
      get root() {
        return selectActiveRoot();
      },
      get focusedPaneId() {
        return selectActiveFocusedPaneId();
      },

      initWithFirstPane: (paneId) => {
        const sess = activeSession();
        if (!sess || sess.layoutRoot !== null) return;
        useSessionsStore.getState().setLayoutRoot(sess.id, leaf(paneId));
        useSessionsStore.getState().setFocusedPane(sess.id, paneId);
      },

      splitPane: (direction, newPaneId, targetId) => {
        const sess = activeSession();
        if (!sess || !sess.layoutRoot) return;
        const target = targetId ?? sess.focusedPaneId;
        if (!target) return;
        const next = splitPaneOp(sess.layoutRoot, target, direction, newPaneId);
        useSessionsStore.getState().setLayoutRoot(sess.id, next);
        useSessionsStore.getState().setFocusedPane(sess.id, newPaneId);
      },

      closePane: (paneId) => {
        const sess = activeSession();
        if (!sess || !sess.layoutRoot) return;
        // Last-pane lock: closing the only leaf in the active session is a
        // no-op here. The session-level "close last pane → stopSession" path
        // is wired in Phase 7's Ctrl+W handler, NOT here.
        const list = leaves(sess.layoutRoot);
        if (list.length <= 1) return;
        const result = closePaneOp(sess.layoutRoot, paneId);
        if (!result) return;
        useSessionsStore.getState().setLayoutRoot(sess.id, result.root);
        useSessionsStore.getState().setFocusedPane(sess.id, result.nextFocus);
      },

      focusPane: (paneId) => {
        const sess = activeSession();
        if (!sess || !sess.layoutRoot) return;
        if (!contains(sess.layoutRoot, paneId)) return;
        useSessionsStore.getState().setFocusedPane(sess.id, paneId);
      },

      moveFocus: (direction) => {
        const sess = activeSession();
        if (!sess || !sess.layoutRoot || !sess.focusedPaneId) return;
        const next = moveFocusOp(sess.layoutRoot, sess.focusedPaneId, direction);
        if (next !== null) useSessionsStore.getState().setFocusedPane(sess.id, next);
      },

      resizeSplit: (a, b, ratio) => {
        const sess = activeSession();
        if (!sess || !sess.layoutRoot) return;
        const next = resizeSplitOp(sess.layoutRoot, a, b, clampRatio(ratio));
        if (next !== sess.layoutRoot) {
          useSessionsStore.getState().setLayoutRoot(sess.id, next);
        }
      },

      reset: () => {
        // Tests-only: clears the entire sessionsStore. UI code never calls this.
        useSessionsStore.getState().reset();
      },
    }),
    { name: "layoutStore (façade)" }
  )
);

// ─── Subscribe-once: bridge sessionsStore changes into useLayoutStore listeners ─
//
// useLayoutStore's getters read sessionsStore on demand, but Zustand
// subscribers attached to useLayoutStore won't auto-fire when sessionsStore
// mutates — they only fire when useLayoutStore.setState runs. To make
// consumer code that does `useLayoutStore((s) => s.root)` reactive, we forward
// sessionsStore changes by calling a no-op setState whenever the active
// session's layoutRoot or focusedPaneId actually changed.
let lastBridge: { root: LayoutNode | null; focus: PaneId | null } = {
  root: null,
  focus: null,
};
useSessionsStore.subscribe((state) => {
  const id = state.activeSessionId;
  const sess = id ? state.sessions[id] : null;
  const root = sess?.layoutRoot ?? null;
  const focus = sess?.focusedPaneId ?? null;
  if (root !== lastBridge.root || focus !== lastBridge.focus) {
    lastBridge = { root, focus };
    // Trigger a no-op setState so Zustand notifies subscribers of useLayoutStore.
    useLayoutStore.setState({});
  }
});

// ─── Convenience exports preserved for compatibility ───────────────────────

export { leaves } from "./layout/tree";

/** Returns the paneIds in the ACTIVE session only. Kept for compatibility. */
export function getPaneIds(state: unknown): PaneId[] {
  const root = selectActiveRoot();
  return root ? leaves(root) : [];
}
```

**Important note for the implementer:** The Zustand `get root()` getter pattern relies on Zustand calling each selector eagerly when the consumer subscribes. If subscribers don't re-render reliably, fall back to keeping `root` and `focusedPaneId` as actual state fields that are kept in sync via a `useSessionsStore.subscribe` callback that calls `useLayoutStore.setState({ root, focusedPaneId })`. Pick whichever works; tests in the next step will catch regressions either way.

- [ ] **Step 3: Run existing tests to confirm the façade preserves behavior**

Run: `npm run test`
Expected: All existing tests pass. The layoutStore-using tests may need their `beforeEach` updated to first create-and-activate a session before any layout operation. If existing tests fail with "cannot read property of null" on root, add a helper:

```typescript
function setupActiveSession() {
  useSessionsStore.getState().reset();
  const id = useSessionsStore.getState().createSession("/test");
  useSessionsStore.getState().activateSession(id);
  return id;
}
```

and call it in `beforeEach` for any existing test that previously expected `useLayoutStore` to be a fresh empty store.

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck` (or `npx tsc --noEmit`)
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/store/layoutStore.ts src/store/sessionsStore.ts
git commit -m "refactor(layout): layoutStore becomes façade over sessionsStore"
```

### Task 1.8: Orchestrator switches to active-paneIds-union subscription

**Files:**
- Modify: `src/terminals/orchestrator.ts`

The orchestrator currently subscribes to `useLayoutStore` and diffs `getPaneIds()` between states. With sessions, "the paneIds currently alive" is the union across all `status === "active"` sessions, not just the active one. Switch to subscribing to `useSessionsStore` and reading via `getActivePaneIds`.

- [ ] **Step 1: Replace the orchestrator's subscription**

In `src/terminals/orchestrator.ts`:

Replace the imports at the top to add:

```typescript
import { useSessionsStore, getActivePaneIds } from "@/store/sessionsStore";
```

Replace the initial-population block and `useLayoutStore.subscribe` block inside `installPtyOrchestrator`. Find this block:

```typescript
  const initial = getPaneIds(useLayoutStore.getState());
  for (const id of initial) {
    // ... existing rescue-spawn loop ...
  }

  const sub = useLayoutStore.subscribe((state, prev) => {
    const curr = getPaneIds(state);
    const before = getPaneIds(prev);
    const added = curr.filter((id) => !before.includes(id));
    const removed = before.filter((id) => !curr.includes(id));
    for (const id of added) void spawnPane(id, defaultShell());
    for (const id of removed) void killPane(id);
  });
```

Replace with:

```typescript
  const initial = getActivePaneIds(useSessionsStore.getState());
  for (const id of initial) {
    void (async () => {
      try { await killPty(id); } catch { /* ignore */ }
      runtimes.get(id)?.inputDisposer.dispose();
      runtimes.delete(id);
      disposeTerminal(id);
      void spawnPane(id, defaultShell());
    })();
  }

  const sub = useSessionsStore.subscribe((state, prev) => {
    const curr = getActivePaneIds(state);
    const before = getActivePaneIds(prev);
    const added = curr.filter((id) => !before.includes(id));
    const removed = before.filter((id) => !curr.includes(id));
    for (const id of added) void spawnPane(id, defaultShell());
    for (const id of removed) void killPane(id);
  });
```

- [ ] **Step 2: Bake folderPath into `spawnPane` for future revives**

The current `spawnPane` calls `openPty({ paneId, shell, cols, rows, channel })` with no cwd. For PHASE 1 we KEEP the existing behavior — adding cwd is a v1.1 candidate. But we DO need to make sure `spawnPane` knows which session a paneId belongs to, in case we want to pass cwd later. For now, leave this as a noted future hook — no code change.

Add a TODO comment above `spawnPane`:

```typescript
// TODO (v1.1): pass cwd = session.folderPath via openPty. See spec §11.4.
```

- [ ] **Step 3: Run all tests**

Run: `npm run test`
Expected: existing orchestrator-related tests pass. If any test pre-populated `layoutStore.root` directly without going through sessionsStore, it will need to be updated to use `createSession` + `activateSession` first.

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/terminals/orchestrator.ts
git commit -m "refactor(orchestrator): subscribe to active-paneIds union from sessionsStore"
```

### Task 1.9: Migration smoke — App.tsx bootstrap creates a session

The App.tsx bootstrap currently does `initWithFirstPane("pane-1")` when root is null. With the façade, that requires an *active* session to exist first. Wire the bootstrap.

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Update bootstrap to create + activate a session before initWithFirstPane**

In `src/App.tsx`, replace `bootstrapEmptyLayout`:

```typescript
    const bootstrapEmptyLayout = async () => {
      const sessions = useSessionsStore.getState();
      // If no sessions exist yet, create one tied to the user's home dir.
      // PHASE 8 will replace this with the migration logic; for now this
      // unblocks Phase 1's smoke test.
      if (Object.keys(sessions.sessions).length === 0) {
        const home = await import("@/lib/fsClient").then((m) => m.homeDir());
        const id = sessions.createSession(home, "New session");
        sessions.activateSession(id);
      } else if (sessions.activeSessionId === null) {
        // We have persisted sessions but none is active — activate the most
        // recently used so the user sees their last project (placeholder
        // behavior; Phase 8's cold-start spec says all stopped).
        const mru = Object.values(sessions.sessions).sort(
          (a, b) => b.lastActiveAt - a.lastActiveAt
        )[0];
        sessions.activateSession(mru.id);
      }
      const { root: existingRoot, initWithFirstPane } = useLayoutStore.getState();
      if (existingRoot === null) {
        initWithFirstPane("pane-1");
      }
    };
```

Add at the top of `App.tsx`:

```typescript
import { useSessionsStore } from "@/store/sessionsStore";
```

And update the `useEffect` to await the async bootstrap:

```typescript
  useEffect(() => {
    const dispose = installPtyOrchestrator();

    let unsubFinishHydration: (() => void) | undefined;
    const go = () => { void bootstrapEmptyLayout(); };
    if (useLayoutStore.persist?.hasHydrated?.() ?? true) {
      go();
    } else {
      unsubFinishHydration = useLayoutStore.persist!.onFinishHydration(go);
    }
    // ... rest unchanged
```

(Note: layoutStore no longer has persist middleware since it's a façade. Add the same hydration gate to `useSessionsStore` instead — but only if it has persist hydration; Phase 8 will fully wire this. For now keep it simple and just `go()`.)

Simpler version that works in Phase 1:

```typescript
  useEffect(() => {
    const dispose = installPtyOrchestrator();
    void bootstrapEmptyLayout();
    return () => {
      dispose();
    };
  }, []);
```

- [ ] **Step 2: Manual smoke test**

Run: `npm run tauri dev`
Expected:
- App launches without errors
- One pane visible
- Sidebar (old file tree) still works
- Splitting (Ctrl+Alt+Right) creates a second pane
- Closing a pane (Ctrl+W) works
- DevTools console has no React warnings

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat(app): bootstrap creates+activates a session at launch"
```

---

### 🔍 Phase 1 Code Review Gate

**Dispatch a code-review subagent** to scrutinize the foundation before Phase 2. The review should check:

- `sessionsStore.ts` correctness: every action mutates the right slice, no accidental cross-session leaks
- The layoutStore façade actually triggers React re-renders when sessionsStore mutates (the "no-op setState bridge" might not be enough — verify by reading PaneTree subscriptions)
- The orchestrator subscription correctly diffs added/removed paneIds without false negatives during the activate/stop transition
- No PTY churn when activating an already-active session (idempotency)
- Typecheck and lint clean
- All vitest tests pass

If the review surfaces issues, fix them inline before moving to Phase 2.

---

## Phase 2: xterm survival mux — `<MainArea>` with display:none multiplex

**Goal:** Mount every active session's `<PaneTree>` simultaneously, gate visibility with `display: none`. xterm Terminal canvases stay attached across switches. Background PTYs keep streaming bytes into their hidden xterm buffers.

**Files created:**
- `src/components/MainArea.tsx` — the new mux
- `src/components/MainArea.module.css`

**Files modified:**
- `src/App.tsx` — main area is now `<MainArea>` not direct `<PaneTree>`

### Task 2.1: `MainArea` component

**Files:**
- Create: `src/components/MainArea.tsx`
- Create: `src/components/MainArea.module.css`

- [ ] **Step 1: Create the CSS module**

`src/components/MainArea.module.css`:

```css
.root {
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}

.sessionPane {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.empty {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  color: var(--fg-2);
  font-family: var(--font-ui);
  font-size: 13px;
}
```

- [ ] **Step 2: Create the MainArea component**

`src/components/MainArea.tsx`:

```typescript
// MainArea — multiplexes one <PaneTree> per active session. Inactive sessions
// stay mounted but display:none, so xterm Terminal instances keep their
// host-div attachment, WebGL canvases preserve state, and background PTYs
// keep writing into hidden buffers. See spec §9.

import { useSessionsStore, type Session } from "@/store/sessionsStore";
import { PaneTree } from "@/components/PaneTree";
import styles from "@/components/MainArea.module.css";

export function MainArea() {
  const sessions = useSessionsStore((s) => s.sessions);
  const activeId = useSessionsStore((s) => s.activeSessionId);

  // Only mount active sessions. Stopped sessions have no PaneTree mounted —
  // see §9.3. Order: active session first in DOM for predictable focus stacking.
  const active: Session[] = Object.values(sessions).filter((s) => s.status === "active");

  if (active.length === 0) {
    return <div className={styles.empty}>No active session — click a session in the sidebar to revive it.</div>;
  }

  return (
    <div className={styles.root}>
      {active.map((s) => (
        <div
          key={s.id}
          className={styles.sessionPane}
          style={{ display: s.id === activeId ? "block" : "none" }}
        >
          {s.layoutRoot && <PaneTree node={s.layoutRoot} path={s.id} />}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Replace direct `<PaneTree>` usage in App.tsx with `<MainArea>`**

In `src/App.tsx`, find:

```tsx
                {root === null ? (
                  <div ...>empty layout</div>
                ) : (
                  <PaneTree node={root} path="root" />
                )}
```

Replace with:

```tsx
                <MainArea />
```

Remove the now-unused `root` destructure and the `PaneTree` import; add `MainArea` import.

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: clean.

- [ ] **Step 5: Smoke test**

Run: `npm run tauri dev`
Expected:
- One session visible
- Splitting works
- Console clean

- [ ] **Step 6: Programmatic multi-session verify**

Open DevTools console:

```javascript
const ss = window.__sessionsStore ?? require("@/store/sessionsStore").useSessionsStore;
// If not exposed, skip this manual verify — Phase 3 will give UI for it.
```

If the store isn't exposed globally yet, skip this step — Phase 3's sidebar will exercise the multi-session path.

- [ ] **Step 7: Commit**

```bash
git add src/components/MainArea.tsx src/components/MainArea.module.css src/App.tsx
git commit -m "feat(app): MainArea mux mounts every active session with display:none gate"
```

---

### 🔍 Phase 2 Code Review Gate

**Dispatch a code-review subagent.** Check:

- `MainArea` re-renders when active session changes but does NOT unmount inactive sessions' PaneTree children
- The PaneTree's recursive children retain their `key`-based React identity across session switches (passes a stable `path` prop derived from session id)
- TerminalPane's `useEffect` doesn't fire `detach` when session switches (the host div stays mounted)
- No regression in existing single-session smoke

---

## Phase 3a: Sidebar skeleton — `SessionsSidebar` + `SessionGroup` + `SessionRow` (read-only)

**Goal:** Render the grouped tree from sessionsStore data. No interactions yet — just the visual layout. After this sub-phase you should see your session(s) under their folder group, clicking does nothing.

**Files created:**
- `src/components/SessionsSidebar.tsx`
- `src/components/SessionsSidebar.module.css`
- `src/components/SessionGroup.tsx`
- `src/components/SessionGroup.module.css`
- `src/components/SessionRow.tsx`
- `src/components/SessionRow.module.css`

### Task 3a.1: `SessionsSidebar` shell

**Files:**
- Create: `src/components/SessionsSidebar.tsx`
- Create: `src/components/SessionsSidebar.module.css`

- [ ] **Step 1: Create the CSS module**

`src/components/SessionsSidebar.module.css`:

```css
.root {
  width: 220px;
  min-width: 220px;
  background: var(--bg-1);
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  font-family: var(--font-ui);
  font-size: 13px;
  color: var(--fg-1);
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
}

.newBtn {
  flex: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 6px 10px;
  background: var(--bg-2);
  color: var(--fg-0);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  font-family: inherit;
  font-size: 12px;
  transition: background 120ms ease, border-color 120ms ease;
}
.newBtn:hover {
  background: var(--bg-3);
  border-color: var(--accent-dim);
}

.menuBtn {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--fg-2);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: color 120ms ease, background 120ms ease;
}
.menuBtn:hover {
  color: var(--fg-0);
  background: var(--bg-2);
}

.list {
  flex: 1;
  overflow-y: auto;
  padding: 6px 0;
}

.empty {
  padding: 20px 14px;
  color: var(--fg-2);
  font-size: 12px;
  text-align: center;
  line-height: 1.5;
}
```

- [ ] **Step 2: Create the component**

`src/components/SessionsSidebar.tsx`:

```typescript
// SessionsSidebar — grouped tree of sessions per folder. See spec §6.
//
// This sub-phase (3a) is read-only — no click/contextmenu/rename handlers yet.
// 3b adds interactions, 3c adds rename and context menus.

import styles from "@/components/SessionsSidebar.module.css";
import { SessionGroup } from "@/components/SessionGroup";
import { groupedSessions, useSessionsStore } from "@/store/sessionsStore";

export function SessionsSidebar() {
  // Re-derive on every sessionsStore change. The selector is cheap (O(N) over
  // sessions); N is small in practice (a handful, not thousands).
  const groups = useSessionsStore((s) => groupedSessions(s));

  return (
    <div className={styles.root}>
      <div className={styles.toolbar}>
        <button className={styles.newBtn} title="New session (Ctrl+Shift+T)" aria-label="New session">
          + New session
        </button>
        <button className={styles.menuBtn} title="Filter & options" aria-label="Filter and options">
          ⋯
        </button>
      </div>
      <div className={styles.list}>
        {groups.length === 0 ? (
          <div className={styles.empty}>
            No sessions yet.
            <br />
            + New session to begin.
          </div>
        ) : (
          groups.map((g) => <SessionGroup key={g.folderPath} group={g} />)
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/SessionsSidebar.tsx src/components/SessionsSidebar.module.css
git commit -m "feat(sessions): SessionsSidebar shell + toolbar"
```

### Task 3a.2: `SessionGroup` component (read-only header + children)

**Files:**
- Create: `src/components/SessionGroup.tsx`
- Create: `src/components/SessionGroup.module.css`

- [ ] **Step 1: CSS**

`src/components/SessionGroup.module.css`:

```css
.group {
  margin-bottom: 4px;
}

.header {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  cursor: pointer;
  color: var(--fg-2);
  font-size: 11px;
  text-transform: none;
  user-select: none;
}
.header:hover {
  background: var(--bg-2);
  color: var(--fg-1);
}

.caret {
  width: 12px;
  display: inline-flex;
  justify-content: center;
  font-size: 10px;
  color: var(--fg-3);
  transition: transform 120ms ease;
}
.caretCollapsed {
  transform: rotate(-90deg);
}

.label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.add {
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--fg-3);
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  opacity: 0;
  transition: opacity 100ms ease, color 100ms ease, background 100ms ease;
}
.header:hover .add {
  opacity: 1;
}
.add:hover {
  color: var(--fg-0);
  background: var(--bg-3);
}

.children {
  padding-left: 0;
}
```

- [ ] **Step 2: Component**

`src/components/SessionGroup.tsx`:

```typescript
// SessionGroup — header + nested session rows. See spec §6.2.
//
// Phase 3a: read-only render. Caret click + per-group `+` + context menu are
// wired in Phase 3b/3c.

import styles from "@/components/SessionGroup.module.css";
import { SessionRow } from "@/components/SessionRow";
import type { SessionGroupView } from "@/store/sessionsStore";

interface Props {
  group: SessionGroupView;
}

export function SessionGroup({ group }: Props) {
  return (
    <div className={styles.group} data-folder={group.folderPath}>
      <div className={styles.header} title={group.folderPath}>
        <span className={`${styles.caret} ${group.collapsed ? styles.caretCollapsed : ""}`}>
          ▾
        </span>
        <span className={styles.label}>{group.label}</span>
        <button className={styles.add} title={`+ session in ${group.label}`} aria-label="Add session to group">
          +
        </button>
      </div>
      {!group.collapsed && (
        <div className={styles.children}>
          {group.sessions.map((s) => (
            <SessionRow key={s.id} session={s} />
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/SessionGroup.tsx src/components/SessionGroup.module.css
git commit -m "feat(sessions): SessionGroup header + collapse state render"
```

### Task 3a.3: `SessionRow` component (read-only)

**Files:**
- Create: `src/components/SessionRow.tsx`
- Create: `src/components/SessionRow.module.css`

- [ ] **Step 1: CSS**

`src/components/SessionRow.module.css`:

```css
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 10px 5px 24px;
  cursor: pointer;
  color: var(--fg-2);
  font-size: 13px;
  user-select: none;
  transition: background 80ms ease, color 80ms ease;
}
.row:hover {
  background: var(--bg-2);
  color: var(--fg-1);
}
.row.active {
  background: var(--bg-3);
  color: var(--fg-0);
  font-weight: 600;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.dotStopped {
  border: 1.5px solid var(--fg-3);
  background: transparent;
}
.dotActive {
  background: var(--accent);
  border: 1.5px solid var(--accent);
}
.dotUnread {
  background: var(--accent);
  border: 1.5px solid var(--accent);
  animation: pulse 1.5s ease-in-out infinite;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.trash {
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--fg-3);
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  opacity: 0;
  font-size: 12px;
  transition: opacity 100ms ease, color 100ms ease, background 100ms ease;
}
.row:hover .trash {
  opacity: 1;
}
.trash:hover {
  color: var(--accent-red, #c84a4a);
  background: var(--bg-3);
}
```

- [ ] **Step 2: Component**

`src/components/SessionRow.tsx`:

```typescript
// SessionRow — one session inside a SessionGroup. Spec §6.3.

import styles from "@/components/SessionRow.module.css";
import { useSessionsStore, type Session } from "@/store/sessionsStore";

interface Props {
  session: Session;
}

export function SessionRow({ session }: Props) {
  const activeId = useSessionsStore((s) => s.activeSessionId);
  const isActive = session.id === activeId;

  const dotClass = isActive
    ? styles.dotActive
    : session.unread
    ? styles.dotUnread
    : styles.dotStopped;

  return (
    <div
      className={`${styles.row} ${isActive ? styles.active : ""}`}
      data-session-id={session.id}
      title={session.name}
    >
      <span className={`${styles.dot} ${dotClass}`} aria-hidden="true" />
      <span className={styles.name}>{session.name}</span>
      <button className={styles.trash} title="Delete session" aria-label="Delete session">
        ×
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/SessionRow.tsx src/components/SessionRow.module.css
git commit -m "feat(sessions): SessionRow with active/stopped/unread dot states"
```

### Task 3a.4: Wire the sidebar into App.tsx (visible alongside old Sidebar)

**Files:**
- Modify: `src/App.tsx`

For Phase 3a we mount `SessionsSidebar` next to the existing `Sidebar` so we can visually verify the new sidebar without breaking the old one. Phase 4 will replace `Sidebar` entirely.

- [ ] **Step 1: Mount alongside**

In `src/App.tsx`, add the import:

```typescript
import { SessionsSidebar } from "@/components/SessionsSidebar";
```

Find the layout body and wrap the sidebar area to show BOTH temporarily:

```tsx
        {sidebarVisible && <SessionsSidebar />}
        {sidebarVisible && <Sidebar />}
        <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
```

- [ ] **Step 2: Smoke test**

Run: `npm run tauri dev`
Expected:
- Sessions sidebar appears on the left
- Shows "+ New session" toolbar + the auto-created session in a group named after your home folder
- Old file-tree sidebar appears immediately to its right
- Status dot for the active session is filled accent

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat(app): mount SessionsSidebar alongside old Sidebar for verification"
```

---

### 🔍 Phase 3a Code Review Gate

**Dispatch a code-review subagent.** Check:

- The `groupedSessions` selector is called via `useSessionsStore` subscribe; React re-renders on session create/activate/rename
- CSS module class composition is correct (no string-concat typos)
- Active/stopped/unread dot states render distinctly
- The "+ New session" button has no onClick yet — that's correct for 3a
- Accessibility: aria-labels present, title tooltips, button elements

---

## Phase 3b: Sidebar interactions — activate / close / collapse / + buttons

**Goal:** Click handlers, folder picker flows, and the three creation entry points (§7).

**Files modified:**
- `src/components/SessionRow.tsx` — onClick to activate, trash to confirm+purge
- `src/components/SessionGroup.tsx` — caret click to collapse, hover-+ to create
- `src/components/SessionsSidebar.tsx` — "+ New session" button wiring
- `src/components/TopBar.tsx` — `📂` Open Folder becomes "go to project"

**Files created:**
- `src/lib/sessions/sessionEntryFlows.ts` — `createAndActivateSession` and `openFolder` helpers

### Task 3b.1: Entry-flow helpers

**Files:**
- Create: `src/lib/sessions/sessionEntryFlows.ts`

- [ ] **Step 1: Create the helpers**

`src/lib/sessions/sessionEntryFlows.ts`:

```typescript
// Three entry points for session creation/activation, all routed through
// these two helpers. See spec §7.

import { useSessionsStore, sessionsForFolder } from "@/store/sessionsStore";
import { pickFolder } from "@/lib/dialogClient";
import { useToastStore } from "@/store/toastStore";

/** Creates a new session and activates it. Used by + New session and per-group +. */
export function createAndActivateSession(folderPath: string, name?: string): string {
  const sessions = useSessionsStore.getState();
  const id = sessions.createSession(folderPath, name);
  sessions.activateSession(id);
  return id;
}

/** "Go to project" semantic — switch to most-recently-active matching session, or create if none. */
export function openFolderAsSession(folderPath: string): string {
  const sessions = useSessionsStore.getState();
  const existing = sessionsForFolder(sessions, folderPath);
  if (existing.length === 0) {
    return createAndActivateSession(folderPath);
  }
  sessions.activateSession(existing[0].id);
  return existing[0].id;
}

/** Combined: pick folder, then run `openFolderAsSession`. Used by topbar 📂. */
export async function pickAndOpenFolder(): Promise<void> {
  try {
    const folder = await pickFolder();
    if (folder !== null) openFolderAsSession(folder);
  } catch (err) {
    useToastStore.getState().push({
      severity: "error",
      message: `Couldn't open folder: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}

/** Combined: pick folder, then ALWAYS create new. Used by sidebar + New session. */
export async function pickAndCreateSession(): Promise<void> {
  try {
    const folder = await pickFolder();
    if (folder !== null) createAndActivateSession(folder);
  } catch (err) {
    useToastStore.getState().push({
      severity: "error",
      message: `Couldn't create session: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/sessions/sessionEntryFlows.ts
git commit -m "feat(sessions): entry-flow helpers (openFolder + createAndActivate)"
```

### Task 3b.2: `SessionRow` click handlers

**Files:**
- Modify: `src/components/SessionRow.tsx`

- [ ] **Step 1: Wire activate + trash → confirm + purge**

```typescript
import { useConfirmStore } from "@/store/confirmStore";
import type { MouseEvent as ReactMouseEvent } from "react";

// Inside SessionRow component:
  const activate = useSessionsStore((s) => s.activateSession);
  const purge = useSessionsStore((s) => s.purgeSession);

  const onClick = () => {
    activate(session.id);
  };

  const onTrash = async (e: ReactMouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const ok = await useConfirmStore.getState().confirm({
      title: "Delete session?",
      message: `Delete session "${session.name}"? This cannot be undone.`,
      confirmLabel: "Delete",
      danger: true,
    });
    if (ok) purge(session.id);
  };

// In JSX:
    <div
      className={...}
      onClick={onClick}
      ...
    >
      ...
      <button
        className={styles.trash}
        onClick={onTrash}
        ...
      >
        ×
      </button>
    </div>
```

- [ ] **Step 2: Smoke test**

Run: `npm run tauri dev`
Click on the existing session → should remain active (no visible change). Trash → confirm dialog → on confirm session disappears.

Now create a second session manually via DevTools:

```javascript
window.__addTestSession = () => {
  const { useSessionsStore } = require("@/store/sessionsStore");
  useSessionsStore.getState().createSession("C:\\Users\\posan\\test-2");
};
```

Or wait until §3b.3 wires the + button.

- [ ] **Step 3: Commit**

```bash
git add src/components/SessionRow.tsx
git commit -m "feat(sessions): SessionRow click activates; trash purges via confirm"
```

### Task 3b.3: `SessionGroup` caret + hover-+

**Files:**
- Modify: `src/components/SessionGroup.tsx`

- [ ] **Step 1: Wire caret toggle + add-session button**

```typescript
import type { MouseEvent as ReactMouseEvent } from "react";
import { useSessionsStore } from "@/store/sessionsStore";
import { createAndActivateSession } from "@/lib/sessions/sessionEntryFlows";

// Inside SessionGroup:
  const toggle = useSessionsStore((s) => s.toggleGroupCollapsed);

  const onHeaderClick = () => {
    toggle(group.folderPath);
  };

  const onAddClick = (e: ReactMouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    createAndActivateSession(group.folderPath);
  };

// JSX:
    <div className={styles.header} onClick={onHeaderClick} title={group.folderPath}>
      ...
      <button className={styles.add} onClick={onAddClick} title="Add session to this project" aria-label="Add session to group">
        +
      </button>
    </div>
```

- [ ] **Step 2: Smoke test**

Click caret → group collapses. Click again → expands. Hover-+ → click → new session appears under that group, active.

- [ ] **Step 3: Commit**

```bash
git add src/components/SessionGroup.tsx
git commit -m "feat(sessions): SessionGroup caret toggle + add-session button"
```

### Task 3b.4: Sidebar + New session button

**Files:**
- Modify: `src/components/SessionsSidebar.tsx`

- [ ] **Step 1: Wire the button**

```typescript
import { pickAndCreateSession } from "@/lib/sessions/sessionEntryFlows";

// In JSX:
      <button className={styles.newBtn} onClick={() => void pickAndCreateSession()} ...>
        + New session
      </button>
```

- [ ] **Step 2: Smoke test**

Click + New session → native folder picker → pick a folder → new session appears in its group (creating the group if it didn't exist), active. Test picking the same folder twice → two siblings under one group with name + name-2.

- [ ] **Step 3: Commit**

```bash
git add src/components/SessionsSidebar.tsx
git commit -m "feat(sessions): + New session wired to folder picker"
```

### Task 3b.5: Topbar `📂` becomes "go to project" (switch-or-create)

**Files:**
- Modify: `src/components/TopBar.tsx`

- [ ] **Step 1: Replace `onOpenFolder` with `pickAndOpenFolder`**

In `src/components/TopBar.tsx`, replace the existing `onOpenFolder` async function with:

```typescript
import { pickAndOpenFolder } from "@/lib/sessions/sessionEntryFlows";
```

Replace the topbar's `onClick={() => void onOpenFolder()}` on the 📂 button with:

```tsx
        <button
          className={styles.btn}
          title="Open Folder — switch or create session (Ctrl+K Ctrl+O)"
          aria-label="Open Folder"
          data-tauri-drag-region="false"
          onClick={() => void pickAndOpenFolder()}
        >
          📂
        </button>
```

Remove the now-unused `pickFolder`/`setWorkspaceFolder`/`useToastStore` imports if they're not referenced elsewhere in the file. (Keep `useSidebarStore`'s other usages.)

- [ ] **Step 2: Smoke test**

Click 📂 → pick a folder that has no existing session → new session created, becomes active. Click 📂 again → pick the same folder → activates the existing session (no new session created).

- [ ] **Step 3: Commit**

```bash
git add src/components/TopBar.tsx
git commit -m "feat(topbar): 📂 becomes switch-or-create session"
```

---

### 🔍 Phase 3b Code Review Gate

**Dispatch a code-review subagent.** Check:

- The three entry points produce the documented behavior in §7
- Clicking the X (trash) doesn't bubble to the row click (no accidental activation)
- Confirm dialog appears for trash, not for activation
- Caret toggle persists across sessionsStore updates (i.e. it stays collapsed)
- The activeId selector update in SessionRow triggers a re-render (the "active" class moves correctly)

---

## Phase 3c: Rename + context menus

**Goal:** Inline rename (group label + session name) and right-click context menus.

**Files modified:**
- `src/components/SessionRow.tsx` — double-click to rename, right-click menu
- `src/components/SessionGroup.tsx` — double-click label to rename, right-click menu

### Task 3c.1: Inline rename UX (extract shared component)

**Files:**
- Create: `src/components/InlineRename.tsx`
- Create: `src/components/InlineRename.module.css`

- [ ] **Step 1: Create the shared inline-rename component**

`src/components/InlineRename.tsx`:

```typescript
// InlineRename — controlled input swap used by SessionRow and SessionGroup.
// Enter to commit, Escape to cancel, blur commits. autoFocus on mount.

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import styles from "@/components/InlineRename.module.css";

interface Props {
  initial: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
  className?: string;
}

export function InlineRename({ initial, onCommit, onCancel, className }: Props) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const commit = () => {
    onCommit(value.trim());
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <input
      ref={ref}
      className={`${styles.input} ${className ?? ""}`}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={commit}
      onClick={(e) => e.stopPropagation()}
    />
  );
}
```

`src/components/InlineRename.module.css`:

```css
.input {
  flex: 1;
  background: var(--bg-0);
  color: var(--fg-0);
  border: 1px solid var(--accent);
  border-radius: var(--radius-sm);
  font-family: inherit;
  font-size: inherit;
  padding: 2px 4px;
  outline: none;
  min-width: 0;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/InlineRename.tsx src/components/InlineRename.module.css
git commit -m "feat(sessions): InlineRename shared component"
```

### Task 3c.2: SessionRow rename (double-click name)

**Files:**
- Modify: `src/components/SessionRow.tsx`

- [ ] **Step 1: Add rename state + double-click handler**

In `SessionRow`, add:

```typescript
import { useState } from "react";
import { InlineRename } from "@/components/InlineRename";

// Inside component:
  const [renaming, setRenaming] = useState(false);
  const rename = useSessionsStore((s) => s.renameSession);

  const onDoubleClick = (e: ReactMouseEvent<HTMLSpanElement>) => {
    e.stopPropagation();
    setRenaming(true);
  };

// In JSX, swap the name span:
      {renaming ? (
        <InlineRename
          initial={session.name}
          onCommit={(value) => {
            rename(session.id, value);
            setRenaming(false);
          }}
          onCancel={() => setRenaming(false)}
        />
      ) : (
        <span className={styles.name} onDoubleClick={onDoubleClick}>
          {session.name}
        </span>
      )}
```

- [ ] **Step 2: Smoke test**

Double-click a session name → input appears. Type → Enter → commits. Escape → cancels. Empty + Enter → reverts to "New session" via renameSession's default-name branch.

- [ ] **Step 3: Commit**

```bash
git add src/components/SessionRow.tsx
git commit -m "feat(sessions): SessionRow inline rename on double-click"
```

### Task 3c.3: SessionGroup rename (double-click label)

**Files:**
- Modify: `src/components/SessionGroup.tsx`

- [ ] **Step 1: Wire group label rename**

```typescript
import { useState } from "react";
import { InlineRename } from "@/components/InlineRename";

// In component:
  const [renaming, setRenaming] = useState(false);
  const setLabel = useSessionsStore((s) => s.setGroupLabel);

  const onLabelDoubleClick = (e: ReactMouseEvent<HTMLSpanElement>) => {
    e.stopPropagation();
    setRenaming(true);
  };

// In JSX, replace the label span:
      {renaming ? (
        <InlineRename
          initial={group.label}
          onCommit={(value) => {
            setLabel(group.folderPath, value);
            setRenaming(false);
          }}
          onCancel={() => setRenaming(false)}
        />
      ) : (
        <span className={styles.label} onDoubleClick={onLabelDoubleClick}>
          {group.label}
        </span>
      )}
```

- [ ] **Step 2: Commit**

```bash
git add src/components/SessionGroup.tsx
git commit -m "feat(sessions): SessionGroup label rename on double-click"
```

### Task 3c.4: Right-click context menus — session row + group header

**Files:**
- Modify: `src/components/SessionRow.tsx`
- Modify: `src/components/SessionGroup.tsx`

Both menus use the existing `useContextMenuStore` (already imported by TerminalPane).

- [ ] **Step 1: SessionRow context menu — Rename · Reveal · Delete**

In `src/components/SessionRow.tsx`:

```typescript
import { useContextMenuStore } from "@/store/contextMenuStore";
import { invoke } from "@tauri-apps/api/core";

// In component:
  const onContextMenu = (e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    useContextMenuStore.getState().openMenu(e.clientX, e.clientY, [
      { label: "Rename", onClick: () => setRenaming(true) },
      { label: "Reveal in Explorer", onClick: () => void revealInExplorer(session.folderPath) },
      { label: "Delete", onClick: () => void onTrash(e as unknown as ReactMouseEvent<HTMLButtonElement>) },
    ]);
  };

// On the row div, add: onContextMenu={onContextMenu}
```

Add a helper `src/lib/revealInExplorer.ts`:

```typescript
import { invoke } from "@tauri-apps/api/core";

export async function revealInExplorer(path: string): Promise<void> {
  try {
    // On Windows: `explorer.exe /select,<path>` or just `explorer.exe <folder>`.
    // We use the plugin-shell open() — well-supported across platforms.
    const { open } = await import("@tauri-apps/plugin-shell");
    await open(path);
  } catch (err) {
    console.warn("revealInExplorer failed", err);
  }
}
```

Wire `revealInExplorer` import in SessionRow.

- [ ] **Step 2: SessionGroup context menu — Rename · Reveal · Collapse · Delete group**

In `src/components/SessionGroup.tsx`:

```typescript
import { useContextMenuStore } from "@/store/contextMenuStore";
import { useConfirmStore } from "@/store/confirmStore";
import { revealInExplorer } from "@/lib/revealInExplorer";

// In component:
  const purgeGroup = useSessionsStore((s) => s.purgeGroup);
  const toggleCollapsed = useSessionsStore((s) => s.toggleGroupCollapsed);

  const onContextMenu = (e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    useContextMenuStore.getState().openMenu(e.clientX, e.clientY, [
      { label: "Rename group", onClick: () => setRenaming(true) },
      { label: "Reveal in Explorer", onClick: () => void revealInExplorer(group.folderPath) },
      { label: group.collapsed ? "Expand" : "Collapse", onClick: () => toggleCollapsed(group.folderPath) },
      {
        label: "Delete group",
        onClick: async () => {
          const ok = await useConfirmStore.getState().confirm({
            title: "Delete group?",
            message: `Delete group "${group.label}" and all ${group.sessions.length} session(s)? This cannot be undone.`,
            confirmLabel: "Delete all",
            danger: true,
          });
          if (ok) purgeGroup(group.folderPath);
        },
      },
    ]);
  };

// On the header div, add: onContextMenu={onContextMenu}
```

- [ ] **Step 3: Smoke test**

Right-click a session row → menu appears with the four items. Each works. Right-click a group header → 4-item menu including the danger "Delete group" with confirm.

- [ ] **Step 4: Commit**

```bash
git add src/components/SessionRow.tsx src/components/SessionGroup.tsx src/lib/revealInExplorer.ts
git commit -m "feat(sessions): right-click context menus for rows and groups"
```

---

### 🔍 Phase 3c Code Review Gate

**Dispatch a code-review subagent.** Check:

- Rename inputs don't bubble click to the row (no accidental activation when clicking the input)
- Escape from rename truly cancels (no spurious commit)
- Context menus close after action via the existing `useContextMenuStore` close-on-click behavior
- Delete-group confirm includes the correct session count

---

## Phase 4: File tree drawer relocation

**Goal:** The old file-tree `Sidebar` content moves into a new `FileDrawer` component, toggled by a new topbar button (per Pre-Phase spec correction).

**Files created:**
- `src/components/FileDrawer.tsx`
- `src/components/FileDrawer.module.css`

**Files modified:**
- `src/components/TopBar.tsx` — new 🗂 button between ☰ and ⊞
- `src/components/App.tsx` — file drawer between sessions sidebar and main
- `src/components/Sidebar.tsx` — DELETE (or keep as dead code until phase ends, then remove)

### Task 4.1: Extract `FileDrawer` from existing `Sidebar`

**Files:**
- Create: `src/components/FileDrawer.tsx`
- Create: `src/components/FileDrawer.module.css`

- [ ] **Step 1: Create FileDrawer**

`src/components/FileDrawer.tsx` — copy the existing `src/components/Sidebar.tsx` body but:

- Read `workspaceFolder` as the **active session's folderPath** (not from sidebarStore)
- Mount only when `sessions[activeId]?.fileTreeOpen === true`

```typescript
// FileDrawer — secondary collapsible panel that shows the file tree for the
// active session's folderPath. Spec §8. Toggled by a topbar button (🗂).
//
// Subscribes to the file watcher only while open; resubscribes on session
// switch using the existing noise-pattern filter and 300ms coalesce.

import { useEffect } from "react";

import styles from "@/components/FileDrawer.module.css";
import { SidebarTree } from "@/components/SidebarTree";
import { useMdStore } from "@/store/mdStore";
import { useSessionsStore } from "@/store/sessionsStore";
import { useSidebarStore } from "@/store/sidebarStore";
import { useToastStore } from "@/store/toastStore";
import { listDir, writeTextFile } from "@/lib/fsClient";
import { watchWorkspace } from "@/lib/fileWatcher";

export function FileDrawer() {
  const activeId = useSessionsStore((s) => s.activeSessionId);
  const session = useSessionsStore((s) => (activeId ? s.sessions[activeId] : null));
  const folder = session?.folderPath ?? null;
  const drawerOpen = session?.fileTreeOpen ?? false;

  const filterText = useSidebarStore((s) => s.filterText);
  const setFilter = useSidebarStore((s) => s.setFilter);
  const storeEntries = useSidebarStore((s) => s.storeEntries);
  const openMdTab = useMdStore((s) => s.openMdTab);

  useEffect(() => {
    if (!drawerOpen || folder === null) return;
    // Same noise-pattern + 300ms coalesce logic from the old Sidebar.tsx.
    const NOISE_PATTERNS = [
      /[/\\]AppData[/\\]/i, /[/\\]\.git([/\\]|$)/i, /[/\\]node_modules([/\\]|$)/i,
      /[/\\]\.cache([/\\]|$)/i, /[/\\]\.turbo([/\\]|$)/i, /[/\\]\.next([/\\]|$)/i,
      /[/\\]target([/\\]|$)/i, /[/\\]dist([/\\]|$)/i, /[/\\]build([/\\]|$)/i,
      /[/\\]\.venv([/\\]|$)/i, /[/\\]__pycache__([/\\]|$)/i,
    ];
    const pendingDirs = new Set<string>();
    let flushTimer: number | null = null;
    const flush = () => {
      flushTimer = null;
      for (const dir of pendingDirs) {
        void listDir(dir).then((es) => storeEntries(dir, es)).catch(() => undefined);
      }
      pendingDirs.clear();
    };
    const schedule = () => {
      if (flushTimer === null) flushTimer = window.setTimeout(flush, 300);
    };
    void listDir(folder).then((es) => storeEntries(folder, es)).catch(() => undefined);
    return watchWorkspace(folder, (e) => {
      if (e.kind === "rescan") {
        void listDir(folder).then((es) => storeEntries(folder, es)).catch(() => undefined);
        return;
      }
      if (NOISE_PATTERNS.some((p) => p.test(e.path))) return;
      const parent = e.path.replace(/[/\\][^/\\]+$/, "");
      if (parent.length === 0) return;
      pendingDirs.add(parent);
      schedule();
    });
  }, [drawerOpen, folder, storeEntries]);

  const onNewFile = async () => {
    if (folder === null) return;
    const name = window.prompt("New file name (relative to project root)");
    if (!name) return;
    const path = `${folder}/${name.endsWith(".md") ? name : `${name}.md`}`;
    try {
      await writeTextFile(path, "");
      await openMdTab(path);
    } catch (e) {
      useToastStore.getState().push({
        severity: "error",
        message: `Could not create file: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  };

  if (!drawerOpen || folder === null) return null;

  return (
    <div className={styles.drawer}>
      <div className={styles.header}>
        <input
          className={styles.filter}
          type="text"
          placeholder="🔍 filter"
          value={filterText}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button className={styles.iconButton} title="New .md file" onClick={onNewFile}>
          ＋
        </button>
      </div>
      <div className={styles.tree}>
        <SidebarTree path={folder} depth={0} />
      </div>
    </div>
  );
}
```

`src/components/FileDrawer.module.css` — copy current `src/components/Sidebar.module.css` verbatim but rename the root class from `.sidebar` to `.drawer`, and set width to `240px`.

- [ ] **Step 2: Commit**

```bash
git add src/components/FileDrawer.tsx src/components/FileDrawer.module.css
git commit -m "feat(sessions): FileDrawer — file tree scoped to active session"
```

### Task 4.2: Topbar 🗂 toggle button

**Files:**
- Modify: `src/components/TopBar.tsx`

- [ ] **Step 1: Add the new button after ☰ and before ⊞**

In the left cluster of `TopBar.tsx`, after the ☰ sidebar button and before the ⊞ split button, insert:

```tsx
        <button
          className={`${styles.btn} ${fileDrawerOpen ? styles.active : ""}`}
          title="Toggle Files (Ctrl+Shift+E)"
          aria-label="Toggle file drawer"
          data-tauri-drag-region="false"
          onClick={onToggleFileDrawer}
        >
          🗂
        </button>
```

Add state and handler:

```typescript
import { useSessionsStore } from "@/store/sessionsStore";

// Inside TopBar:
  const activeId = useSessionsStore((s) => s.activeSessionId);
  const fileDrawerOpen = useSessionsStore((s) =>
    activeId ? s.sessions[activeId]?.fileTreeOpen ?? false : false
  );

  const onToggleFileDrawer = () => {
    if (activeId) useSessionsStore.getState().toggleFileTree(activeId);
  };
```

- [ ] **Step 2: Smoke test**

Click 🗂 → expects no visible change yet (FileDrawer not wired into App.tsx). The store flips `fileTreeOpen`.

- [ ] **Step 3: Commit**

```bash
git add src/components/TopBar.tsx
git commit -m "feat(topbar): 🗂 button toggles per-session file drawer state"
```

### Task 4.3: Wire FileDrawer into App.tsx; remove old Sidebar

**Files:**
- Modify: `src/App.tsx`
- Delete: `src/components/Sidebar.tsx`, `src/components/Sidebar.module.css`

- [ ] **Step 1: Wire FileDrawer between SessionsSidebar and main**

```typescript
import { FileDrawer } from "@/components/FileDrawer";
// Remove: import { Sidebar } from "@/components/Sidebar";
```

In the JSX:

```tsx
        {sidebarVisible && <SessionsSidebar />}
        <FileDrawer />
        <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
          ...
```

(`<FileDrawer />` renders null when closed — no need for conditional wrapping.)

- [ ] **Step 2: Delete old Sidebar files**

```bash
rm src/components/Sidebar.tsx src/components/Sidebar.module.css
```

- [ ] **Step 3: Run typecheck**

Run: `npm run typecheck`
Expected: any remaining imports of `Sidebar` break → fix them. (If `Sidebar.test.tsx` exists, delete it too.)

- [ ] **Step 4: Run tests**

Run: `npm run test`
Expected: green. Adjust any tests that imported old Sidebar.

- [ ] **Step 5: Smoke test**

Run: `npm run tauri dev`
Expected: only the sessions sidebar shows by default. Click 🗂 → file drawer appears at 240px width with the active session's folder tree. Click 🗂 again → drawer closes. Create a second session for a different folder, activate it → file drawer (if open) re-subscribes and shows that session's folder.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git rm src/components/Sidebar.tsx src/components/Sidebar.module.css
git commit -m "feat(app): replace old Sidebar with SessionsSidebar + FileDrawer"
```

---

### 🔍 Phase 4 Code Review Gate

**Dispatch a code-review subagent.** Check:

- File watcher correctly resubscribes on session switch with drawer open
- No watcher leaks (cleanup function returned from useEffect)
- 🗂 button highlights correctly when drawer is open for active session, but not for other sessions
- Filter input still works (lives in sidebarStore, not session-scoped — confirm this is acceptable for v1)

---

## Phase 5: Git branch poller

**Goal:** `sessions[id].gitBranch` populated from `git rev-parse --abbrev-ref HEAD` every 5s on window focus + on revive. Status bar shows the branch.

**Files created:**
- `src-tauri/src/git.rs`
- `src/sessions/branchPoller.ts`

**Files modified:**
- `src-tauri/src/lib.rs` — register the command
- `src/App.tsx` — install the poller
- `src/components/StatusBar.tsx` — show the branch

### Task 5.1: Rust `git_current_branch` command with timeout

**Files:**
- Create: `src-tauri/src/git.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Implement the command**

`src-tauri/src/git.rs`:

```rust
//! `git_current_branch` Tauri command. Runs `git rev-parse --abbrev-ref HEAD`
//! against a folder path with a 2-second timeout. Returns the trimmed branch
//! name on success, None on any failure (not a git repo, missing git binary,
//! deleted folder, detached HEAD, timeout).
//!
//! Wrapped in a thread + mpsc to enforce the timeout because std::process
//! has no native timeout — Command::output() blocks until the child exits.

use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

const TIMEOUT: Duration = Duration::from_secs(2);

#[tauri::command]
pub fn git_current_branch(path: String) -> Option<String> {
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let result = Command::new("git")
            .args(["rev-parse", "--abbrev-ref", "HEAD"])
            .current_dir(&path)
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output();
        let _ = tx.send(result);
    });
    let output = rx.recv_timeout(TIMEOUT).ok()?.ok()?;
    if !output.status.success() {
        return None;
    }
    let branch = String::from_utf8(output.stdout).ok()?.trim().to_string();
    if branch.is_empty() || branch == "HEAD" {
        // Empty = error. "HEAD" = detached. Treat as no branch.
        return None;
    }
    Some(branch)
}
```

- [ ] **Step 2: Register in lib.rs**

In `src-tauri/src/lib.rs`, add:

```rust
mod git;

// In the .invoke_handler chain:
.invoke_handler(tauri::generate_handler![
    // ... existing handlers ...
    git::git_current_branch,
])
```

- [ ] **Step 3: Build to verify**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`
Expected: clean compile.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/git.rs src-tauri/src/lib.rs
git commit -m "feat(rust): git_current_branch command with 2s timeout"
```

### Task 5.2: JS branchPoller module

**Files:**
- Create: `src/sessions/branchPoller.ts`

- [ ] **Step 1: Implement the poller**

`src/sessions/branchPoller.ts`:

```typescript
// Git branch poller. Runs every 5s while the window is focused. Polls each
// session whose status === "active". Updates sessionsStore.gitBranch.
//
// Also exposes pollOne(id) for explicit-poll triggers (activate, revive).

import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useSessionsStore } from "@/store/sessionsStore";

const POLL_INTERVAL_MS = 5000;

let timer: number | null = null;
let isFocused = true;

async function pollOne(sessionId: string): Promise<void> {
  const sess = useSessionsStore.getState().sessions[sessionId];
  if (!sess || sess.status !== "active") return;
  try {
    const branch = await invoke<string | null>("git_current_branch", {
      path: sess.folderPath,
    });
    useSessionsStore.getState().updateBranch(sessionId, branch);
  } catch (err) {
    console.warn(`branchPoller(${sessionId}) failed`, err);
    useSessionsStore.getState().updateBranch(sessionId, null);
  }
}

function tick() {
  if (!isFocused) return;
  const state = useSessionsStore.getState();
  for (const s of Object.values(state.sessions)) {
    if (s.status === "active") void pollOne(s.id);
  }
}

export function installBranchPoller(): () => void {
  // Set up window focus tracking — pause polling when window blurs.
  let unlistenFocus: (() => void) | undefined;
  let unlistenBlur: (() => void) | undefined;
  void getCurrentWindow().listen("tauri://focus", () => {
    isFocused = true;
    tick(); // immediate refresh on focus regain
  }).then((un) => { unlistenFocus = un; });
  void getCurrentWindow().listen("tauri://blur", () => {
    isFocused = false;
  }).then((un) => { unlistenBlur = un; });

  // Subscribe to sessionsStore — trigger an immediate poll when a session's
  // status flips to "active" (revive).
  let prevStatuses: Record<string, string> = {};
  for (const s of Object.values(useSessionsStore.getState().sessions)) {
    prevStatuses[s.id] = s.status;
  }
  const unsubStatus = useSessionsStore.subscribe((state) => {
    for (const s of Object.values(state.sessions)) {
      const prev = prevStatuses[s.id];
      if (prev !== "active" && s.status === "active") {
        void pollOne(s.id);
      }
      prevStatuses[s.id] = s.status;
    }
  });

  // Interval tick.
  timer = window.setInterval(tick, POLL_INTERVAL_MS);
  // Kick off an initial scan.
  tick();

  return () => {
    if (timer !== null) window.clearInterval(timer);
    timer = null;
    unsubStatus();
    unlistenFocus?.();
    unlistenBlur?.();
  };
}
```

- [ ] **Step 2: Install in App.tsx**

In `App.tsx`'s useEffect:

```typescript
import { installBranchPoller } from "@/sessions/branchPoller";

// Inside the existing useEffect:
    const disposePoller = installBranchPoller();

    return () => {
      disposePoller();
      dispose();
      // ... existing cleanup ...
    };
```

- [ ] **Step 3: Smoke test**

Run: `npm run tauri dev` inside a git repo. After ~5s the active session should have `gitBranch` populated (verify via DevTools console: `window.__sessions ?? useSessionsStore.getState().sessions`).

- [ ] **Step 4: Commit**

```bash
git add src/sessions/branchPoller.ts src/App.tsx
git commit -m "feat(sessions): git branch poller (5s, focus-aware, per-session)"
```

### Task 5.3: Status bar shows the branch

**Files:**
- Modify: `src/components/StatusBar.tsx`

- [ ] **Step 1: Read existing StatusBar and add branch segment**

Read `src/components/StatusBar.tsx` first. Then in its left-segment terminal branch, add:

```typescript
import { useSessionsStore } from "@/store/sessionsStore";

// In the component:
  const activeId = useSessionsStore((s) => s.activeSessionId);
  const session = useSessionsStore((s) => (activeId ? s.sessions[activeId] : null));

// Where the existing "shell · cwd" text is built, replace with:
  const groupLabel = session
    ? (useSessionsStore.getState().groupLabels[session.folderPath] ?? basename(session.folderPath))
    : "";
  const sessionName = session?.name ?? "";
  const branch = session?.gitBranch;

  // Build the segment string in pieces — template literals with nested ternary
  // get unreadable fast. Each part is added only when its source is non-empty.
  let display: string;
  if (!session) {
    display = "no session";
  } else {
    const parts: string[] = [`${groupLabel} / ${sessionName}`];
    if (shell) parts.push(shell);
    if (branch) parts.push(`⎇ ${branch}`);
    display = parts.join("  ·  ");
  }
```

Use a `` icon if you have a font that supports it; otherwise plain text "branch:".

Import `basename` from groupingHelpers.

- [ ] **Step 2: Commit**

```bash
git add src/components/StatusBar.tsx
git commit -m "feat(statusbar): show <group>/<session> · shell · branch when terminal focused"
```

---

### 🔍 Phase 5 Code Review Gate

**Dispatch a code-review subagent.** Check:

- Branch poller correctly pauses on window blur and resumes on focus
- 2s timeout prevents UNC-path hangs (spec §15 risk #3)
- The 5s interval doesn't drift after long backgrounds (resets to fresh interval on focus regain — verify)
- `git rev-parse` errors don't show user-visible toasts (silent failure, branch = null)

---

## Phase 6: OSC notification handlers

**Goal:** xterm's parser fires our handler on `OSC 9`/`99`/`777`. Bumps `unread` on the owning session. Sidebar dot animates.

**Files created:**
- `src/sessions/oscNotifications.ts`

**Files modified:**
- `src/components/TerminalPane.tsx` — register handlers on mount
- `src/terminals/registry.ts` — expose the Terminal instance for handler registration

### Task 6.1: Implement OSC handler module

**Files:**
- Create: `src/sessions/oscNotifications.ts`

- [ ] **Step 1: Implement**

`src/sessions/oscNotifications.ts`:

```typescript
// OSC notification handlers. See spec §10.2.
//
// xterm.js's `parser.registerOscHandler(N, cb)` returns an IDisposable. The
// handler receives the OSC string contents and returns a boolean: true =
// "handled, don't pass through", false = "let other handlers run". We return
// true to absorb the sequence (we don't want the title bar to update for OSC 9
// since some shells use it as a notification convention, not a window title).

import type { Terminal } from "@xterm/xterm";
import { findSessionForPane, useSessionsStore } from "@/store/sessionsStore";
import type { PaneId } from "@/types";

const OSC_CODES = [9, 99, 777] as const;

/** Register OSC handlers on a Terminal. Returns disposer. */
export function registerOscHandlers(paneId: PaneId, term: Terminal): () => void {
  const disposers = OSC_CODES.map((code) =>
    term.parser.registerOscHandler(code, (_data: string) => {
      const session = findSessionForPane(useSessionsStore.getState(), paneId);
      if (session) {
        useSessionsStore.getState().bumpUnread(session.id);
      }
      // Absorb the sequence — we don't propagate to default handlers.
      return true;
    })
  );
  return () => {
    for (const d of disposers) d.dispose();
  };
}
```

- [ ] **Step 2: Wire into TerminalPane**

In `src/components/TerminalPane.tsx`, inside the existing `useEffect`, add (after the keydown listener registration):

```typescript
import { getOrCreateTerminal } from "@/terminals/registry";
import { registerOscHandlers } from "@/sessions/oscNotifications";

// Inside useEffect:
    const term = getOrCreateTerminal(paneId);
    const unregisterOsc = registerOscHandlers(paneId, term);
```

In the cleanup:

```typescript
    return () => {
      // ... existing cleanup ...
      unregisterOsc();
    };
```

Note: if `getOrCreateTerminal` isn't already exported from registry, export it or use the existing equivalent.

- [ ] **Step 3: Test manually**

Run: `npm run tauri dev`. In a session, run from PowerShell:

```powershell
Write-Host -NoNewline "`e]9;hello from osc 9`a"
```

Expected: the session's unread dot pulses if you're viewing a DIFFERENT session. If you're viewing this session, no unread (since bumpUnread is no-op for active session).

- [ ] **Step 4: Commit**

```bash
git add src/sessions/oscNotifications.ts src/components/TerminalPane.tsx
git commit -m "feat(sessions): OSC 9/99/777 notification handlers"
```

---

### 🔍 Phase 6 Code Review Gate

**Dispatch a code-review subagent.** Check:

- OSC handlers don't fire on built-in title-set sequences (we return true to absorb, but verify shells using OSC 0/2 for title aren't accidentally caught)
- Handler cleanup runs on pane unmount (no leak when pane is split-then-closed)
- Unread dot animation visible across the sidebar

---

## Phase 7: Shortcuts + status bar polish

**Goal:** New shortcuts wired; status bar's last-pane-in-session behavior changes to `stopSession`.

**Files modified:**
- `src/hooks/useKeyboardShortcuts.ts`
- `src/lib/confirmStrings.ts` — new string for "last pane → stop session"

### Task 7.1: `Ctrl+Shift+T` new session

**Files:**
- Modify: `src/hooks/useKeyboardShortcuts.ts`

- [ ] **Step 1: Add the shortcut**

In `src/hooks/useKeyboardShortcuts.ts`, add to the shortcuts array:

```typescript
import { pickAndCreateSession } from "@/lib/sessions/sessionEntryFlows";

// Add a new shortcut:
  {
    match: (e) => e.ctrlKey && e.shiftKey && !e.altKey && (e.key === "T" || e.key === "t"),
    run: () => {
      void pickAndCreateSession();
      return true;
    },
  },
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useKeyboardShortcuts.ts
git commit -m "feat(shortcuts): Ctrl+Shift+T new session"
```

### Task 7.2: `Ctrl+Tab` / `Ctrl+Shift+Tab` cycle

**Files:**
- Modify: `src/hooks/useKeyboardShortcuts.ts`

- [ ] **Step 1: Add session cycling using groupedSessions render order**

```typescript
import { useSessionsStore, groupedSessions } from "@/store/sessionsStore";

function cycleSession(delta: 1 | -1): boolean {
  const state = useSessionsStore.getState();
  const flat = groupedSessions(state).flatMap((g) => g.sessions);
  if (flat.length === 0) return false;
  const idx = state.activeSessionId
    ? flat.findIndex((s) => s.id === state.activeSessionId)
    : -1;
  const nextIdx = ((idx + delta) + flat.length) % flat.length;
  useSessionsStore.getState().activateSession(flat[nextIdx].id);
  return true;
}

// Shortcuts:
  {
    match: (e) => e.ctrlKey && !e.shiftKey && !e.altKey && e.key === "Tab",
    run: () => cycleSession(1),
  },
  {
    match: (e) => e.ctrlKey && e.shiftKey && !e.altKey && e.key === "Tab",
    run: () => cycleSession(-1),
  },
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useKeyboardShortcuts.ts
git commit -m "feat(shortcuts): Ctrl+Tab cycles sessions"
```

### Task 7.3: `Ctrl+1` .. `Ctrl+9` jump to N-th session

**Files:**
- Modify: `src/hooks/useKeyboardShortcuts.ts`

- [ ] **Step 1: Add jump shortcuts**

```typescript
function jumpToSession(n: number): boolean {
  const state = useSessionsStore.getState();
  const flat = groupedSessions(state).flatMap((g) => g.sessions);
  if (n < 1 || n > flat.length) return false;
  useSessionsStore.getState().activateSession(flat[n - 1].id);
  return true;
}

// Generate 9 shortcuts:
  ...Array.from({ length: 9 }, (_, i) => ({
    match: (e: KeyboardEvent) =>
      e.ctrlKey && !e.altKey && !e.shiftKey && e.key === String(i + 1),
    run: () => jumpToSession(i + 1),
  })),
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useKeyboardShortcuts.ts
git commit -m "feat(shortcuts): Ctrl+1..9 jump to N-th session"
```

### Task 7.4: `Ctrl+Shift+E` toggle file drawer

**Files:**
- Modify: `src/hooks/useKeyboardShortcuts.ts`

- [ ] **Step 1: Add shortcut**

```typescript
  {
    match: (e) => e.ctrlKey && e.shiftKey && !e.altKey && (e.key === "E" || e.key === "e"),
    run: () => {
      const activeId = useSessionsStore.getState().activeSessionId;
      if (activeId) {
        useSessionsStore.getState().toggleFileTree(activeId);
        return true;
      }
      return false;
    },
  },
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useKeyboardShortcuts.ts
git commit -m "feat(shortcuts): Ctrl+Shift+E toggle file drawer"
```

### Task 7.5: Last-pane-in-session close → stopSession

**Files:**
- Modify: `src/hooks/useKeyboardShortcuts.ts`
- Modify: `src/lib/confirmStrings.ts`

- [ ] **Step 1: Add the confirm string**

In `src/lib/confirmStrings.ts`:

```typescript
import type { ConfirmRequest } from "@/store/confirmStore";

export function closeLastPaneInSessionConfirm(sessionName: string): ConfirmRequest {
  return {
    title: "Stop session?",
    message: `This is the last pane in "${sessionName}". Closing it will stop the session — it stays in the sidebar and you can revive it later. Continue?`,
    confirmLabel: "Stop session",
    danger: false,
  };
}
```

- [ ] **Step 2: Update the Ctrl+W handler**

In `useKeyboardShortcuts.ts`, replace `closeFocusedAsync`:

```typescript
import { closeLastPaneInSessionConfirm } from "@/lib/confirmStrings";
import { leaves } from "@/store/layout/tree";

async function closeFocusedAsync(): Promise<boolean> {
  const sessions = useSessionsStore.getState();
  const activeId = sessions.activeSessionId;
  if (!activeId) return false;
  const session = sessions.sessions[activeId];
  if (!session || !session.layoutRoot) return false;
  const focused = session.focusedPaneId;
  if (focused === null) return false;

  // Existing busy-confirm gate
  try {
    const busy = await isPtyBusy(focused);
    if (busy) {
      const ok = await useConfirmStore.getState().confirm(closeBusyPaneConfirm(focused));
      if (!ok) return false;
    }
  } catch (err) {
    console.warn("isPtyBusy check failed", err);
  }

  // Last-pane semantics: if this would close the only pane, stop the session instead.
  if (leaves(session.layoutRoot).length === 1) {
    const ok = await useConfirmStore.getState().confirm(closeLastPaneInSessionConfirm(session.name));
    if (!ok) return false;
    useSessionsStore.getState().stopSession(activeId);
    return true;
  }

  useLayoutStore.getState().closePane(focused);
  return true;
}
```

- [ ] **Step 3: Smoke test**

Open a session, split into 2 panes, close one → second pane closes, no confirm prompt. Close the remaining pane → "Stop session?" prompt appears → confirm → session goes stopped (greyed in sidebar), no pane visible.

- [ ] **Step 4: Commit**

```bash
git add src/hooks/useKeyboardShortcuts.ts src/lib/confirmStrings.ts
git commit -m "feat(shortcuts): last pane close → stopSession with confirm"
```

---

### 🔍 Phase 7 Code Review Gate

**Dispatch a code-review subagent.** Check:

- Ctrl+Tab cycles through sessions in the displayed sidebar order (groups + sessions flattened)
- Ctrl+1..9 skips empty groups but flattens correctly
- Last-pane close confirm wording is correct
- Shortcuts don't fire when focus is in MD Editor (existing focus-surface gating should still apply — verify)

---

## Phase 8: Persistence + migration

**Goal:** sessionsStore persists across restart per §11.1. Old `layoutStore.root` users get auto-migrated into one session.

**Files modified:**
- `src/store/sessionsStore.ts` — partializer + rehydration
- `src/App.tsx` — migration logic in bootstrap

### Task 8.1: Partializer + rehydration

**Files:**
- Modify: `src/store/sessionsStore.ts`

- [ ] **Step 1: Write a test for rehydration coercion**

Add to `sessionsStore.test.ts`:

```typescript
describe("sessionsStore — rehydration", () => {
  it("coerces every session status to stopped and clears activeSessionId", () => {
    // Simulate a persist payload that had stale active state
    const raw = {
      sessions: {
        a: {
          id: "a", name: "A", folderPath: "/p", layoutRoot: null, focusedPaneId: null,
          status: "active", unread: true, gitBranch: "main", fileTreeOpen: true,
          createdAt: 1, lastActiveAt: 2,
        },
      },
      activeSessionId: "a",
      groupLabels: {},
      collapsedGroups: [],
    };
    // Apply the same coercion the partializer + onRehydrateStorage do.
    // For unit-test purposes, call the exported helper directly:
    const { coerceRehydrated } = require("@/store/sessionsStore");
    const out = coerceRehydrated(raw);
    expect(out.sessions.a.status).toBe("stopped");
    expect(out.sessions.a.unread).toBe(false);
    expect(out.activeSessionId).toBeNull();
  });
});
```

- [ ] **Step 2: Implement partializer + coerceRehydrated**

In `src/store/sessionsStore.ts`:

```typescript
// Pure function — exported for testing and used inside onRehydrateStorage.
export function coerceRehydrated(state: Partial<SessionsState>): Partial<SessionsState> {
  const sessions: Record<string, Session> = {};
  for (const [id, s] of Object.entries(state.sessions ?? {})) {
    sessions[id] = {
      ...s,
      status: "stopped",
      unread: false,
    } as Session;
  }
  // Drop groupLabels / collapsedGroups entries whose folderPath has no sessions
  const folderSet = new Set(Object.values(sessions).map((s) => s.folderPath));
  const groupLabels: Record<string, string> = {};
  for (const [path, label] of Object.entries(state.groupLabels ?? {})) {
    if (folderSet.has(path)) groupLabels[path] = label;
  }
  const collapsedGroups = (state.collapsedGroups ?? []).filter((p) => folderSet.has(p));
  return {
    sessions,
    activeSessionId: null,
    groupLabels,
    collapsedGroups,
  };
}
```

Update the `persist` config in the store creation:

```typescript
      {
        name: "sessions",
        storage: createJSONStorage(() => tauriPersistStorage("workstation-store.json")),
        version: 1,
        partialize: (state) => ({
          sessions: Object.fromEntries(
            Object.entries(state.sessions).map(([id, s]) => [
              id,
              {
                id: s.id,
                name: s.name,
                folderPath: s.folderPath,
                layoutRoot: s.layoutRoot,
                focusedPaneId: s.focusedPaneId,
                gitBranch: s.gitBranch,
                fileTreeOpen: s.fileTreeOpen,
                createdAt: s.createdAt,
                lastActiveAt: s.lastActiveAt,
                // status, unread NOT persisted
                status: "stopped" as SessionStatus,
                unread: false,
              },
            ])
          ),
          groupLabels: state.groupLabels,
          collapsedGroups: state.collapsedGroups,
        }),
        onRehydrateStorage: () => (state) => {
          if (!state) return;
          const coerced = coerceRehydrated(state);
          // Apply coerced fields back onto the store. Zustand's persist replaces
          // state wholesale on rehydrate, so any post-rehydrate cleanup goes here.
          useSessionsStore.setState(coerced as SessionsState);
        },
      }
```

- [ ] **Step 3: Run test**

Run: `npm run test -- sessionsStore`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/store/sessionsStore.ts src/store/sessionsStore.test.ts
git commit -m "feat(sessions): partializer + onRehydrate coercion to stopped/null"
```

### Task 8.2: Migration from old `layoutStore.root` users

**Files:**
- Modify: `src/App.tsx`
- Create: `src/sessions/migration.ts`

- [ ] **Step 1: Implement migration helper**

`src/sessions/migration.ts`:

```typescript
// One-shot migration from v0.1's single-tree layoutStore to v0.2's sessionsStore.
//
// Runs at bootstrap ONCE: if workstation-store.json has no `sessions` key and
// the legacy `layout`/`sidebar` keys ARE present, builds one session from them.
//
// We can't read the persisted JSON directly here (the persist middleware
// rewires it on rehydrate). Instead we detect the migration state via:
//   - useSessionsStore.getState().sessions is empty (no sessions ever persisted)
//   - useLayoutStore reports it had a persisted root pre-rehydrate
//
// In practice, the cleanest signal is: sessionsStore has zero sessions AND
// the OLD layoutStore.root WAS non-null at App boot (we read it BEFORE the
// façade null-checked it via activeSessionId).

import { useSessionsStore } from "@/store/sessionsStore";
import { useSidebarStore } from "@/store/sidebarStore";
import { homeDir } from "@/lib/fsClient";
import type { LayoutNode } from "@/store/layout/tree";

interface LegacyHints {
  oldLayoutRoot: LayoutNode | null;
  oldWorkspaceFolder: string | null;
}

export async function runMigrationIfNeeded(hints: LegacyHints): Promise<void> {
  const sessions = useSessionsStore.getState();
  if (Object.keys(sessions.sessions).length > 0) return; // already migrated or new sessions exist
  const folder = hints.oldWorkspaceFolder ?? (await homeDir());
  const id = sessions.createSession(folder, "New session");
  if (hints.oldLayoutRoot) {
    sessions.setLayoutRoot(id, hints.oldLayoutRoot);
  }
  sessions.toggleFileTree(id); // open file drawer by default for migrated user (matches v0.1 UX)
  // Status stays stopped per cold-start rule. User clicks to revive.
}
```

- [ ] **Step 2: Update App.tsx bootstrap to call migration**

In `src/App.tsx`, replace `bootstrapEmptyLayout`:

```typescript
import { runMigrationIfNeeded } from "@/sessions/migration";

    const bootstrapEmptyLayout = async () => {
      const oldRoot = useLayoutStore.getState().root; // read via façade — may be null
      const oldWs = useSidebarStore.getState().workspaceFolder;
      await runMigrationIfNeeded({ oldLayoutRoot: oldRoot, oldWorkspaceFolder: oldWs });
      // Per spec §3: cold-start = all stopped. Don't auto-activate.
      // BUT: if literally no sessions exist (fresh install), create one for home
      // and activate so the user has something to do.
      const sessions = useSessionsStore.getState();
      if (Object.keys(sessions.sessions).length === 0) {
        const home = await homeDir();
        const id = sessions.createSession(home, "New session");
        sessions.activateSession(id);
      }
      // Bootstrap first pane if active session has no layoutRoot.
      const layoutState = useLayoutStore.getState();
      if (layoutState.root === null && useSessionsStore.getState().activeSessionId !== null) {
        layoutState.initWithFirstPane("pane-1");
      }
    };
```

- [ ] **Step 3: Run all tests**

Run: `npm run test`
Expected: green. May need to update old layoutStore-touching tests.

- [ ] **Step 4: Smoke test — fresh install**

Delete `~/.local/share/<app>/workstation-store.json` (or its Windows equivalent under `%APPDATA%`). Run `npm run tauri dev`. Expected: one session created at home dir, status active, one pane visible.

- [ ] **Step 5: Smoke test — v0.1 user**

Restore an older `workstation-store.json` from before this feature (you may need to check it out via git from before the sessionsStore commits). Run `npm run tauri dev`. Expected: one session created from migration, status stopped, sidebar shows it dimmed; click to activate; pane appears with the old layout shape.

- [ ] **Step 6: Smoke test — multi-session restart**

Create 3 sessions, activate one, quit. Restart. Expected: all 3 sessions in sidebar, all stopped (dimmed). Click any one to revive.

- [ ] **Step 7: Commit**

```bash
git add src/sessions/migration.ts src/App.tsx
git commit -m "feat(sessions): v0.1→v0.2 migration + bootstrap logic"
```

### Task 8.3: Clean up legacy `layoutStore` persistence

**Files:**
- Modify: `src/store/layoutStore.ts`

The layoutStore is now a façade and shouldn't write to disk. Confirm no `persist` middleware is wrapping it. If there's a vestigial `layout` key in `workstation-store.json` left from v0.1, leave it — it's harmless, and we don't need to actively wipe it.

- [ ] **Step 1: Verify layoutStore has no persist middleware**

`grep "persist" src/store/layoutStore.ts` should return nothing if Task 1.7 was done correctly.

- [ ] **Step 2: No commit needed unless cleanup was required.**

---

### 🔍 Phase 8 Final Review Gate

**Dispatch a code-review subagent for the full feature.** Check:

- All spec sections implemented (§1-§13)
- All locked decisions honored (multi-name per folder, stop-but-remember, cold start all-stopped, cmux-light row metadata)
- All non-goals correctly NOT implemented (no ports column, no PR status, no embedded browser, no per-pane cwd, no scrollback snapshot)
- §11.4 persistence contract upheld (only the documented fields persisted)
- All tests pass
- Manual smoke covers: fresh install, migrated v0.1, multi-session restart, session activate/stop/purge, group rename/collapse/delete, OSC notification, branch poll, all shortcuts

---

## Cross-cutting verification commands

Each phase has its own gate. These commands apply throughout:

- `npm run test` — full vitest suite
- `npm run typecheck` — TypeScript clean
- `npm run lint` — ESLint clean
- `cargo check --manifest-path src-tauri/Cargo.toml` — Rust compile
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` — Rust lint
- `cargo fmt --manifest-path src-tauri/Cargo.toml --check` — Rust format
- `npm run tauri dev` — manual smoke

If any phase ends with a regression in `npm run test`, FIX before advancing.

---

## Summary

**Phases:** 1 → 2 → 3a → 3b → 3c → 4 → 5 → 6 → 7 → 8

**Code-review gates:** 8 (after each phase / sub-phase)

**Estimated tasks:** 9 + 1 + 4 + 5 + 4 + 3 + 3 + 1 + 5 + 3 = 38 distinct tasks across all phases

**Estimated LoC:** ~1450 new + ~250 delta per spec Appendix A

**External dependencies added:** none (all new tooling reuses existing tauri + zustand + xterm stack)

**Spec deviation:** ☰ stays as sessions sidebar toggle (Ctrl+B); new 🗂 button + Ctrl+Shift+E added for file drawer. Pre-Phase Task P0 updates the spec to reflect this.
