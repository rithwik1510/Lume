import { describe, expect, it } from "vitest";

import { agentFromCommand } from "@/sessions/agentIdentity";
import type { AgentName } from "@/store/agentStore";

describe("agentIdentity — agentFromCommand", () => {
  const cases: [string, string, AgentName | null][] = [
    // Bare binaries.
    ["bare claude", "claude", "claude"],
    ["bare codex", "codex", "codex"],
    ["bare gemini", "gemini", "gemini"],
    // Case + extension + surrounding args.
    ["uppercase + args", "CLAUDE --resume", "claude"],
    ["windows .exe", "claude.exe", "claude"],
    ["windows .CMD (case-insensitive ext)", "claude.CMD", "claude"],
    ["ps1 shim", "gemini.ps1", "gemini"],
    // Absolute paths, both separators.
    [
      "windows AppData path",
      "C:\\Users\\x\\AppData\\Roaming\\npm\\claude.CMD --dangerously",
      "claude",
    ],
    ["posix path", "/usr/local/bin/codex", "codex"],
    // Quoted path with spaces.
    ['quoted path with spaces', '"C:\\Program Files\\nodejs\\claude.cmd"', "claude"],
    // Runners → inspect following tokens.
    ["npx bare", "npx claude", "claude"],
    ["npx -y scoped codex", "npx -y @openai/codex", "codex"],
    ["npx scoped claude-code", "npx @anthropic-ai/claude-code", "claude"],
    ["npx scoped gemini-cli", "npx @google/gemini-cli", "gemini"],
    ["scoped with version tag", "npx @openai/codex@latest", "codex"],
    ["pnpm dlx subcommand", "pnpm dlx @openai/codex", "codex"],
    ["bunx bare", "bunx gemini", "gemini"],
    ["bun x subcommand", "bun x codex", "codex"],
    // Version suffix on a bare name.
    ["bare with version", "claude@1.2.3", "claude"],
    // Non-agents → null.
    ["plain git", "git", null],
    ["git subcommand", "git status", null],
    ["unrelated tool", "npm run dev", null],
    ["runner with no agent", "npx create-vite my-app", null],
    ["substring near-miss", "claude-helper", null],
    ["empty", "", null],
    ["whitespace only", "   \t ", null],
  ];

  it.each(cases)("%s → %s", (_desc, command, expected) => {
    expect(agentFromCommand(command)).toBe(expected);
  });
});
