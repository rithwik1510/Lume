// src/store/settingsStore.test.ts
import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@/lib/configClient", () => ({
  setConfigValue: vi.fn(async () => undefined),
}));

import { setConfigValue as rustSetConfigValue } from "@/lib/configClient";
import { useSettingsStore, defaultSettings } from "@/store/settingsStore";
import type { WorkstationConfig } from "@/types/config";

describe("settingsStore", () => {
  beforeEach(() => {
    useSettingsStore.getState().reset();
  });

  it("starts with the default settings", () => {
    expect(useSettingsStore.getState().config).toEqual(defaultSettings);
  });

  it("applyConfig replaces config with the input", () => {
    const cfg: WorkstationConfig = {
      ...defaultSettings,
      default_shell: "cmd",
      font: { family: "Inter", size: 16, weight: 400, line_height: 1.2 },
    };
    useSettingsStore.getState().applyConfig(cfg);
    expect(useSettingsStore.getState().config.default_shell).toBe("cmd");
    expect(useSettingsStore.getState().config.font.size).toBe(16);
  });

  it("applyConfig records a lastValidConfig snapshot", () => {
    const cfg: WorkstationConfig = {
      ...defaultSettings,
      default_shell: "powershell",
    };
    useSettingsStore.getState().applyConfig(cfg);
    expect(useSettingsStore.getState().lastValidConfig).toEqual(cfg);
  });

  it("revertToLastValid restores the snapshot", () => {
    const good: WorkstationConfig = { ...defaultSettings, default_shell: "pwsh" };
    useSettingsStore.getState().applyConfig(good);

    // Force an in-place mutation as if a hot-reload had brought bad data
    useSettingsStore.setState({
      config: { ...defaultSettings, default_shell: "garbage" },
    });
    useSettingsStore.getState().revertToLastValid();
    expect(useSettingsStore.getState().config).toEqual(good);
  });

  it("reset returns to defaults and revert is a no-op", () => {
    const cfg: WorkstationConfig = { ...defaultSettings, default_shell: "cmd" };
    useSettingsStore.getState().applyConfig(cfg);
    useSettingsStore.getState().reset();
    expect(useSettingsStore.getState().config).toEqual(defaultSettings);
    useSettingsStore.getState().revertToLastValid();
    expect(useSettingsStore.getState().config).toEqual(defaultSettings);
  });
});

describe("settingsStore.setConfigValue", () => {
  beforeEach(() => {
    useSettingsStore.getState().reset();
    vi.clearAllMocks();
    vi.useRealTimers();
  });
  it("updates the in-store config optimistically by dotted path", () => {
    useSettingsStore.getState().setConfigValue("font.size", 18);
    expect(useSettingsStore.getState().config.font.size).toBe(18);
  });
  it("persists via the Rust client (debounced)", async () => {
    vi.useFakeTimers();
    useSettingsStore.getState().setConfigValue("terminal.cursor_style", "bar");
    useSettingsStore.getState().setConfigValue("terminal.cursor_style", "underline");
    await vi.advanceTimersByTimeAsync(300);
    expect(rustSetConfigValue).toHaveBeenCalledTimes(1);
    expect(rustSetConfigValue).toHaveBeenCalledWith("terminal.cursor_style", "underline");
  });
  it("reverts the optimistic value when the Rust write rejects", async () => {
    vi.useFakeTimers();
    (rustSetConfigValue as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("disk full"));
    const before = useSettingsStore.getState().config.font.size;
    useSettingsStore.getState().setConfigValue("font.size", 22);
    expect(useSettingsStore.getState().config.font.size).toBe(22);
    await vi.advanceTimersByTimeAsync(300);
    await Promise.resolve();
    expect(useSettingsStore.getState().config.font.size).toBe(before);
  });
});
