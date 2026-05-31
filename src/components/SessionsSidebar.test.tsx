// src/components/SessionsSidebar.test.tsx
//
// Regression test for the Zustand v5 "unstable snapshot" black-screen crash:
// SessionsSidebar must not subscribe with a selector that returns a NEW
// reference every call (groupedSessions builds a fresh array). Under Zustand
// v5 + React's useSyncExternalStore that throws "The result of getSnapshot
// should be cached to avoid an infinite loop", which (with no error boundary)
// blanks the whole app. These tests render the component; if it re-introduces
// the bad selector, render() throws and the tests fail.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// sessionsStore uses persist via tauriPersistStorage — mock the plugin so the
// real store imports cleanly in the test environment.
vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => ({
    get: vi.fn(async () => null),
    set: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    save: vi.fn(async () => undefined),
  })),
}));

import { SessionsSidebar } from "@/components/SessionsSidebar";
import { useSessionsStore } from "@/store/sessionsStore";

describe("SessionsSidebar", () => {
  beforeEach(() => {
    useSessionsStore.getState().reset();
  });

  it("renders the toolbar with no sessions (empty new-array selector must be stable)", () => {
    render(<SessionsSidebar />);
    expect(screen.getByText("+ New session")).toBeTruthy();
    expect(screen.getByText(/No sessions yet/i)).toBeTruthy();
  });

  it("renders a group header + session row without an infinite-loop crash", () => {
    useSessionsStore.getState().createSession("/home/me/proj", "Work");
    render(<SessionsSidebar />);
    expect(screen.getByText("Work")).toBeTruthy(); // session name
    expect(screen.getByText("proj")).toBeTruthy(); // group label = folder basename
  });
});
