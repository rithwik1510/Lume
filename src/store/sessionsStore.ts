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
import { leaves as treeLeaves } from "@/store/layout/tree";
import type { PaneId } from "@/types";
import { tauriPersistStorage } from "@/lib/persistStorage";
import { autoSuffixSessionName, basename, samePath } from "@/lib/sessions/groupingHelpers";

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
  createSession: (folderPath: string, name?: string) => SessionId;
  activateSession: (id: SessionId) => void;
  stopSession: (id: SessionId) => void;
  purgeSession: (id: SessionId) => void;
  purgeGroup: (folderPath: string) => void;
  renameSession: (id: SessionId, name: string) => void;
  setGroupLabel: (folderPath: string, label: string) => void;
  toggleGroupCollapsed: (folderPath: string) => void;
  bumpUnread: (id: SessionId) => void;
  clearUnread: (id: SessionId) => void;
  updateBranch: (id: SessionId, branch: string | null) => void;
  setLayoutRoot: (id: SessionId, root: LayoutNode | null) => void;
  setFocusedPane: (id: SessionId, paneId: PaneId | null) => void;
  toggleFileTree: (id: SessionId) => void;
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
      immer((set, get) => ({
        ...emptyState(),
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
        // Persist the durable per-session fields + grouping state. status and
        // unread are written as stopped/false (they're never meaningfully
        // persisted — see §11.1); activeSessionId is omitted entirely so cold
        // start is always all-stopped (spec §3). onRehydrateStorage re-coerces
        // defensively in case an older payload carried stale values.
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
          // Zustand's persist replaces state wholesale on rehydrate; apply the
          // coercion (status→stopped, unread→false, activeSessionId→null, drop
          // orphaned group entries) as a post-rehydrate cleanup.
          useSessionsStore.setState(coerceRehydrated(state) as SessionsState);
        },
      }
    ),
    { name: "sessionsStore" }
  )
);

// Pure coercion applied on rehydrate (and unit-tested directly). Enforces the
// §11 persistence contract: status is always "stopped" on launch, unread is
// cleared, activeSessionId is null (cold start = all-stopped), and group label
// / collapsed entries whose folderPath no longer has any session are dropped.
export function coerceRehydrated(state: Partial<SessionsState>): Partial<SessionsState> {
  const sessions: Record<string, Session> = {};
  for (const [id, s] of Object.entries(state.sessions ?? {})) {
    sessions[id] = { ...s, status: "stopped", unread: false } as Session;
  }
  const folderSet = new Set(Object.values(sessions).map((s) => s.folderPath));
  const groupLabels: Record<string, string> = {};
  for (const [path, label] of Object.entries(state.groupLabels ?? {})) {
    if (folderSet.has(path)) groupLabels[path] = label;
  }
  const collapsedGroups = (state.collapsedGroups ?? []).filter((p) => folderSet.has(p));
  return { sessions, activeSessionId: null, groupLabels, collapsedGroups };
}

// ---------------------------------------------------------------------------
// Selectors (top-level pure functions over state — NOT store methods).
// Used by the sidebar renderer and the active-pane orchestrator.
// ---------------------------------------------------------------------------

export function sessionsForFolder(state: SessionsState, folderPath: string): Session[] {
  return Object.values(state.sessions)
    .filter((s) => samePath(s.folderPath, folderPath))
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt);
}

export interface SessionGroupView {
  folderPath: string;
  label: string; // groupLabels[folderPath] ?? basename(folderPath)
  collapsed: boolean;
  sessions: Session[]; // sorted by lastActiveAt desc
}

export function groupedSessions(state: SessionsState): SessionGroupView[] {
  // Bucket by exact folderPath (string identity, no normalization beyond
  // what's already stored). Same-folder dedup is handled by samePath where
  // it matters; this is the render-input grouping.
  //
  // Cache max lastActiveAt during the bucket loop so the group-sort step
  // doesn't have to spread session arrays inside the comparator. This is
  // both safer (Math.max(...[]) === -Infinity silently misorders empty
  // groups) and faster (O(n) instead of O(n^2·k) when sorting).
  const byFolder: Record<string, Session[]> = {};
  const maxByFolder: Record<string, number> = {};
  for (const s of Object.values(state.sessions)) {
    (byFolder[s.folderPath] ??= []).push(s);
    const prev = maxByFolder[s.folderPath];
    if (prev === undefined || s.lastActiveAt > prev) {
      maxByFolder[s.folderPath] = s.lastActiveAt;
    }
  }
  const groups: SessionGroupView[] = Object.entries(byFolder).map(([folderPath, sessions]) => ({
    folderPath,
    label: state.groupLabels[folderPath] ?? basename(folderPath),
    collapsed: state.collapsedGroups.includes(folderPath),
    sessions: sessions.sort((a, b) => b.lastActiveAt - a.lastActiveAt),
  }));
  // Sort groups by cached max-child lastActiveAt desc. Empty-sessions groups
  // never exist by construction (we only create a bucket when we push), so
  // maxByFolder is always populated for any folderPath in groups.
  groups.sort((a, b) => (maxByFolder[b.folderPath] ?? 0) - (maxByFolder[a.folderPath] ?? 0));
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
