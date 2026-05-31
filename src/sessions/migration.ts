// One-shot migration / first-run seeding for the session manager.
//
// Runs at bootstrap AFTER sessionsStore has rehydrated. Three cases:
//
//   1. Routine restart — sessionsStore already has persisted sessions.
//      Returns null. Caller activates nothing; all sessions stay stopped
//      per the cold-start rule (spec §3); the user clicks one to revive.
//
//   2. v0.1 upgrade — no persisted sessions, but the legacy sidebarStore
//      still has a persisted workspaceFolder. We seed one session at that
//      folder so the user lands back in their project. Returns its id so
//      the caller activates it (this is a one-time upgrade event, not a
//      routine restart, so activating is the friendly behavior).
//
//   3. Fresh install — no persisted sessions, no legacy workspace. Seed one
//      session at the home dir and return its id to activate.
//
// Note on oldLayoutRoot: v0.1 persisted the pane tree under layoutStore's own
// "layout" key, but the façade's partialize is now `() => ({})` so that key is
// no longer loaded — `useLayoutStore.getState().root` is null at cold start.
// We accept the hint for completeness, but in practice the migrated session
// starts with no layoutRoot and the caller's initWithFirstPane seeds a fresh
// single pane. The project folder is recovered; the exact old split shape is
// not (acceptable for an alpha upgrade).

import { useSessionsStore } from "@/store/sessionsStore";
import { homeDir } from "@/lib/fsClient";
import type { LayoutNode } from "@/store/layout/tree";

interface LegacyHints {
  oldLayoutRoot: LayoutNode | null;
  oldWorkspaceFolder: string | null;
}

/**
 * Seeds a session on first run / v0.1 upgrade. Returns the id of a session the
 * caller should activate, or null when persisted sessions already exist
 * (routine restart — leave all stopped).
 */
export async function runMigrationIfNeeded(hints: LegacyHints): Promise<string | null> {
  const sessions = useSessionsStore.getState();
  if (Object.keys(sessions.sessions).length > 0) {
    return null; // routine restart — sessions rehydrated, stay all-stopped
  }
  const folder = hints.oldWorkspaceFolder ?? (await homeDir());
  const id = sessions.createSession(folder, "New session");
  if (hints.oldLayoutRoot) {
    sessions.setLayoutRoot(id, hints.oldLayoutRoot);
  }
  // Open the file drawer by default for a seeded session — matches the v0.1
  // UX where the file tree sidebar was always visible.
  sessions.toggleFileTree(id);
  return id;
}
