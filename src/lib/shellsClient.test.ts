import { describe, it, expect, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
import { shellToConfigId, configIdMatchesShell } from "@/lib/shellsClient";

describe("shell config ids", () => {
  it("uses kind for non-wsl shells", () => {
    expect(shellToConfigId({ kind: "pwsh", path: "x" })).toBe("pwsh");
    expect(shellToConfigId({ kind: "cmd", path: "x" })).toBe("cmd");
  });
  it("namespaces wsl by distro", () => {
    expect(shellToConfigId({ kind: "wsl", distro: "Ubuntu" })).toBe("wsl:Ubuntu");
  });
  it("matches a config id against a shell", () => {
    expect(configIdMatchesShell("wsl:Ubuntu", { kind: "wsl", distro: "Ubuntu" })).toBe(true);
    expect(configIdMatchesShell("pwsh", { kind: "cmd", path: "x" })).toBe(false);
  });
});
