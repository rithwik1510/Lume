import { describe, it, expect } from "vitest";
import { terminalOptionsFromConfig } from "@/terminals/applySettings";
import { defaultSettings } from "@/store/settingsStore";

describe("terminalOptionsFromConfig", () => {
  it("maps config fields onto xterm option keys", () => {
    const opts = terminalOptionsFromConfig({
      ...defaultSettings,
      font: { ...defaultSettings.font, size: 18, weight: 600, line_height: 1.5 },
      terminal: { ...defaultSettings.terminal, cursor_style: "bar", cursor_blink: false, scrollback_lines: 5000 },
    });
    expect(opts).toEqual({
      fontSize: 18, fontWeight: "600", lineHeight: 1.5,
      cursorStyle: "bar", cursorBlink: false, scrollback: 5000,
    });
  });
});
