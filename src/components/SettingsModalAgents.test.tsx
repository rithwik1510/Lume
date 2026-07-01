import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@/lib/shellsClient", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/shellsClient")>();
  return { ...actual, detectShells: vi.fn(async () => []) };
});

// Hook client is mocked so the test never touches ~/.claude/settings.json.
const installClaudeHooks = vi.fn(async () => undefined);
const uninstallClaudeHooks = vi.fn(async () => undefined);
let statusValue = false;
vi.mock("@/lib/claudeHooksClient", () => ({
  claudeHooksStatus: vi.fn(async () => statusValue),
  installClaudeHooks: () => installClaudeHooks(),
  uninstallClaudeHooks: () => uninstallClaudeHooks(),
}));

import { SettingsModal } from "@/components/SettingsModal";
import { useSettingsModalStore } from "@/store/settingsModalStore";
import { useSettingsStore } from "@/store/settingsStore";
import { useAgentStore } from "@/store/agentStore";

describe("SettingsModal — Agents / precise signals", () => {
  beforeEach(() => {
    installClaudeHooks.mockClear();
    uninstallClaudeHooks.mockClear();
    statusValue = false;
    useSettingsStore.getState().reset();
    useAgentStore.getState().reset();
    useSettingsModalStore.setState({ open: true, category: "agents" });
  });

  it("enabling the toggle installs the hooks", async () => {
    render(<SettingsModal />);
    const toggle = await screen.findByLabelText("Precise Claude Code signals");
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    await waitFor(() => expect(installClaudeHooks).toHaveBeenCalledTimes(1));
  });

  it("shows the canary warning when installed but no SessionStart seen", async () => {
    statusValue = true; // hooks already installed on disk
    render(<SettingsModal />);
    // Once the status query resolves, the not-detected-yet warning appears.
    expect(await screen.findByText(/no Claude Code session has been detected/i)).toBeTruthy();
  });

  it("confirms active once a SessionStart has been observed", async () => {
    statusValue = true;
    useAgentStore.getState().markSessionStart();
    render(<SettingsModal />);
    expect(await screen.findByText(/receiving Claude Code signals/i)).toBeTruthy();
  });
});
