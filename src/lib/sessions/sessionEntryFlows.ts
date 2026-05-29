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
