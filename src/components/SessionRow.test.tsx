// SessionRow signal rendering (Plan 008). Follows SessionsSidebar.test.tsx:
// mock the persist plugin so sessionsStore imports cleanly, then drive the
// agent store + session visibility and assert the row's accessible signal.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: vi.fn(async () => null),
    set: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    save: vi.fn(async () => undefined),
  })),
}));

import { SessionRow } from "@/components/SessionRow";
import { useSessionsStore } from "@/store/sessionsStore";
import { useAgentStore, type AgentPhase } from "@/store/agentStore";
import { leaf } from "@/store/layout/tree";

function bgSessionWithPane(paneId: string): string {
  const s = useSessionsStore.getState();
  const bg = s.createSession("/proj", "Work");
  s.setLayoutRoot(bg, leaf(paneId));
  // Make a DIFFERENT session the visible one so `bg` can signal.
  const fg = s.createSession("/other", "Front");
  s.activateSession(fg);
  return bg;
}

function rowLabel(container: HTMLElement, sessionId: string): string {
  const el = container.querySelector(`[data-session-id="${sessionId}"]`);
  return el?.getAttribute("aria-label") ?? "";
}

beforeEach(() => {
  useSessionsStore.getState().reset();
  useAgentStore.getState().reset();
});

describe("SessionRow — agent signals", () => {
  it("permission: aria-label names the reason and the agent glyph shows", () => {
    const bg = bgSessionWithPane("pane-a");
    useAgentStore.getState().setPaneAgent("pane-a", { agent: "claude", phase: "permission" });
    const session = useSessionsStore.getState().sessions[bg];
    const { container } = render(<SessionRow session={session} />);
    expect(rowLabel(container, bg)).toBe("Work — Claude — waiting on permission");
    expect(container.textContent).toContain("✻"); // identity glyph
  });

  it("your-move: aria-label reports turn complete", () => {
    const bg = bgSessionWithPane("pane-a");
    useAgentStore.getState().setPaneAgent("pane-a", { agent: "claude", phase: "your-move" });
    const session = useSessionsStore.getState().sessions[bg];
    const { container } = render(<SessionRow session={session} />);
    expect(rowLabel(container, bg)).toBe("Work — Claude — turn complete");
  });

  it("idle agent shows the glyph but no signal in the label", () => {
    const bg = bgSessionWithPane("pane-a");
    useAgentStore.getState().setPaneAgent("pane-a", { agent: "claude", phase: "idle" as AgentPhase });
    const session = useSessionsStore.getState().sessions[bg];
    const { container } = render(<SessionRow session={session} />);
    expect(rowLabel(container, bg)).toBe("Work"); // idle → no reason appended
    expect(container.textContent).toContain("✻");
  });

  it("the visible session never signals even with a live agent", () => {
    const s = useSessionsStore.getState();
    const id = s.createSession("/proj", "Work");
    s.setLayoutRoot(id, leaf("pane-a"));
    s.activateSession(id); // this session IS visible
    useAgentStore.getState().setPaneAgent("pane-a", { agent: "claude", phase: "permission" });
    const session = useSessionsStore.getState().sessions[id];
    const { container } = render(<SessionRow session={session} />);
    expect(rowLabel(container, id)).toBe("Work"); // suppressed
  });
});
