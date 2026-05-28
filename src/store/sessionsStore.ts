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
import { autoSuffixSessionName, samePath } from "@/lib/sessions/groupingHelpers";

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
        partialize: () => ({} as Partial<SessionsState>),
      }
    ),
    { name: "sessionsStore" }
  )
);
