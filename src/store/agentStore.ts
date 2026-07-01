// agentStore — transient per-pane state of hooked coding agents (Plan 008 §5).
//
// This is the frontend face of the deterministic "class A" signal: the Rust
// spool watcher emits `agent-event`, sessions/agentTracker runs the per-pane
// state machine, and the result lands here for the sidebar to render (blocked
// ring / your-move dot / agent glyph). NEVER persisted — an agent's state is
// meaningless across a restart (the PTY and the agent are both gone), exactly
// like sessionsStore.working / unread.
//
// Keyed by paneId (a session can run several agents, one per pane); the sidebar
// aggregates a session's panes via sessions/sessionSignal.

import { create } from "zustand";
import { immer } from "zustand/middleware/immer";

import type { PaneId } from "@/types";

/** The agents Lume can identify by hook. Only Claude Code in this plan; the
 *  glyph map + state machine extend to Codex/Gemini without structural change. */
export type AgentName = "claude";

/** Per-pane agent phase. `idle` = SessionStart seen, no turn yet (calm, no
 *  signal); `working` = a turn is in progress; `permission` = blocked mid-turn
 *  on a permission prompt; `your-move` = turn complete / waiting at the prompt
 *  (Stop and idle_prompt collapse here). SessionEnd removes the entry. */
export type AgentPhase = "idle" | "working" | "permission" | "your-move";

export interface PaneAgent {
  agent: AgentName;
  phase: AgentPhase;
  /** Recorded from SessionStart — dashboard fuel for later plans. */
  sessionId?: string;
  transcriptPath?: string;
}

interface AgentStoreState {
  panes: Record<PaneId, PaneAgent>;
  /** Canary (Plan 008 §5): flips true the first time ANY SessionStart arrives.
   *  If the hooks are installed but this stays false after a Claude Code launch,
   *  the settings toggle shows the "hooks not detected" warning. */
  sawSessionStart: boolean;
  setPaneAgent: (paneId: PaneId, agent: PaneAgent) => void;
  removePaneAgent: (paneId: PaneId) => void;
  markSessionStart: () => void;
  /** View-acknowledgment (mirrors activateSession's `unread = false`): a
   *  "your move" you've now seen calms back to idle. Permission is exempt —
   *  a still-blocked agent is still urgent, so it never acknowledges. */
  acknowledgeYourMove: (paneIds: PaneId[]) => void;
  /** Cadence-assisted exit from the blocked state (attentionTracker): the
   *  approval of a permission prompt fires no hook event until the turn ends,
   *  so sustained output while "permission" means the block is over. */
  demotePermissionToWorking: (paneId: PaneId) => void;
  reset: () => void;
}

export const useAgentStore = create<AgentStoreState>()(
  immer((set) => ({
    panes: {},
    sawSessionStart: false,
    setPaneAgent: (paneId, agent) =>
      set((s) => {
        s.panes[paneId] = agent;
      }),
    removePaneAgent: (paneId) =>
      set((s) => {
        delete s.panes[paneId];
      }),
    markSessionStart: () =>
      set((s) => {
        s.sawSessionStart = true;
      }),
    acknowledgeYourMove: (paneIds) =>
      set((s) => {
        for (const paneId of paneIds) {
          const pa = s.panes[paneId];
          if (pa?.phase === "your-move") pa.phase = "idle";
        }
      }),
    demotePermissionToWorking: (paneId) =>
      set((s) => {
        const pa = s.panes[paneId];
        if (pa?.phase === "permission") pa.phase = "working";
      }),
    reset: () =>
      set((s) => {
        s.panes = {};
        s.sawSessionStart = false;
      }),
  }))
);
