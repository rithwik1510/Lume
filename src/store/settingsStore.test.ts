// src/store/settingsStore.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { useSettingsStore, defaultSettings } from "@/store/settingsStore";
import type { WorkstationConfig } from "@/types/config";

vi.mock("@/lib/configClient", () => ({
  readConfig: vi.fn(),
  writeDefaultConfigIfMissing: vi.fn(),
  watchConfig: vi.fn(),
  configFilePath: vi.fn(),
}));

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
      font: { family: "Inter", size: 16 },
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
});
