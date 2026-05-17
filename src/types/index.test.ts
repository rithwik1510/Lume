import { describe, it, expect } from "vitest";
import { formatAppError, type AppError } from "./index";

describe("formatAppError", () => {
  it("formats pty_spawn_failed", () => {
    const e: AppError = { kind: "pty_spawn_failed", reason: "wsl not found" };
    expect(formatAppError(e)).toBe("PTY spawn failed: wsl not found");
  });

  it("formats pty_write_failed", () => {
    const e: AppError = { kind: "pty_write_failed", reason: "broken pipe" };
    expect(formatAppError(e)).toBe("PTY write failed: broken pipe");
  });

  it("formats pty_resize_failed", () => {
    const e: AppError = { kind: "pty_resize_failed", reason: "ioctl ENOTTY" };
    expect(formatAppError(e)).toBe("PTY resize failed: ioctl ENOTTY");
  });

  it("formats pty_not_found with pane_id", () => {
    const e: AppError = { kind: "pty_not_found", pane_id: "pane-7" };
    expect(formatAppError(e)).toBe("PTY not found for pane pane-7");
  });

  it("formats internal", () => {
    const e: AppError = { kind: "internal", reason: "mutex poisoned" };
    expect(formatAppError(e)).toBe("Internal error: mutex poisoned");
  });
});
