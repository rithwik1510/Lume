// agentIdentity — map a captured launch command to the coding agent it starts.
//
// Glyph-only identity: this classifies "which agent" from the command line the
// user ran (agentTracker registers it as a phase-`idle`, source-`command`
// entry). It NEVER drives phase — Claude's exact state stays hook-owned; Codex
// and Gemini panes keep the output heuristics. Anything unrecognized is null,
// which leaves the pane on pure heuristics.
//
// Parsing is a first-token heuristic over the same imperfect launch line
// commandCapture reconstructs (path/quotes/extension tolerated). Runners
// (npx/pnpx/bunx/pnpm/bun) delegate: the agent is the package/binary they run.

import type { AgentName } from "@/store/agentStore";

/** First-token runners whose real target is a following token. */
const RUNNERS = new Set(["npx", "pnpx", "bunx", "pnpm", "bun"]);

export function agentFromCommand(command: string): AgentName | null {
  const tokens = tokenize(command);
  if (tokens.length === 0) return null;

  const first = baseName(tokens[0]);
  if (RUNNERS.has(first)) {
    // Skip flags (-y, --yes) and runner subcommands (dlx/exec/x/run don't
    // match an agent); the first token that resolves to an agent wins.
    for (let i = 1; i < tokens.length; i++) {
      if (tokens[i].startsWith("-")) continue;
      const hit = agentFromPackage(tokens[i]) ?? agentFromName(baseName(tokens[i]));
      if (hit) return hit;
    }
    return null;
  }
  return agentFromName(first);
}

/** Bare binary / bare package name → agent. */
function agentFromName(name: string): AgentName | null {
  switch (name) {
    case "claude":
      return "claude";
    case "codex":
      return "codex";
    case "gemini":
      return "gemini";
    default:
      return null;
  }
}

/** Scoped npm package specifier → agent (version suffix tolerated). */
function agentFromPackage(spec: string): AgentName | null {
  switch (stripVersion(stripQuotes(spec.trim()).toLowerCase())) {
    case "@anthropic-ai/claude-code":
      return "claude";
    case "@openai/codex":
      return "codex";
    case "@google/gemini-cli":
      return "gemini";
    default:
      return null;
  }
}

/** First token normalized to a bare, lowercased, extension-less command name:
 *  strips quotes, any path prefix, a runner extension, and a `@version` tail. */
function baseName(token: string): string {
  let t = stripQuotes(token.trim()).toLowerCase();
  const sep = Math.max(t.lastIndexOf("/"), t.lastIndexOf("\\"));
  if (sep !== -1) t = t.slice(sep + 1);
  t = t.replace(/\.(exe|cmd|ps1)$/, "");
  return stripVersion(t);
}

/** Drop a trailing `@version`. A leading `@` (scope) is part of the name, so
 *  only an `@` past index 0 is a version separator. */
function stripVersion(spec: string): string {
  const at = spec.lastIndexOf("@");
  return at > 0 ? spec.slice(0, at) : spec;
}

function stripQuotes(t: string): string {
  if (t.length >= 2) {
    const a = t[0];
    const b = t[t.length - 1];
    if ((a === '"' && b === '"') || (a === "'" && b === "'")) return t.slice(1, -1);
  }
  return t;
}

/** Whitespace split honoring single/double quotes (so a quoted path with
 *  spaces stays one token; the surrounding quotes are consumed). */
function tokenize(command: string): string[] {
  const tokens: string[] = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  let hasCur = false;
  for (const ch of command) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      hasCur = true;
    } else if (ch === " " || ch === "\t") {
      if (hasCur) {
        tokens.push(cur);
        cur = "";
        hasCur = false;
      }
    } else {
      cur += ch;
      hasCur = true;
    }
  }
  if (hasCur) tokens.push(cur);
  return tokens;
}
