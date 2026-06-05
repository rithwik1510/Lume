// Git branch poller. Runs every 5s while the window is focused. Polls each
// session whose status === "active". Updates sessionsStore.gitBranch.
//
// Also triggers an immediate poll when a session's status flips to "active"
// (revive) so the branch shows up without waiting for the next 5s tick.
//
// Failures are silent (branch → null, console.warn only) — a missing git
// binary or non-repo folder shouldn't surface a user-facing toast.

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
  // Reset focus flag so a re-install (HMR) doesn't inherit a stale blurred state.
  isFocused = true;

  // Window focus tracking — pause polling when the window blurs (no point
  // hammering git for a window the user isn't looking at), resume + refresh
  // immediately on focus regain.
  let unlistenFocus: (() => void) | undefined;
  let unlistenBlur: (() => void) | undefined;
  void getCurrentWindow()
    .listen("tauri://focus", () => {
      isFocused = true;
      tick();
    })
    .then((un) => {
      unlistenFocus = un;
    });
  void getCurrentWindow()
    .listen("tauri://blur", () => {
      isFocused = false;
    })
    .then((un) => {
      unlistenBlur = un;
    });

  // Subscribe to sessionsStore — trigger an immediate poll when a session's
  // status flips stopped → active (revive).
  const prevStatuses: Record<string, string> = {};
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

  if (timer !== null) window.clearInterval(timer);
  timer = window.setInterval(tick, POLL_INTERVAL_MS);
  // Kick off an initial scan for any already-active session.
  tick();

  return () => {
    if (timer !== null) window.clearInterval(timer);
    timer = null;
    unsubStatus();
    unlistenFocus?.();
    unlistenBlur?.();
  };
}
