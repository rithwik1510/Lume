# Weekend 3 — Implementation Notes

Running log of decisions, deviations, and trade-offs made while executing `2026-05-22-weekend-3-md-and-sidebar.md`. Updated by the executing agent as each phase lands. Read this before reviewing each phase commit.

## Format

Each section is one phase or one task. Bullet points keep the noise low. Anything that ISN'T just "executed the plan as written" should land here.

Categories to capture:
- **Decision:** something the plan left unspecified that had to be picked
- **Deviation:** plan said one thing, reality required another
- **Trade-off:** chose option A over B and you should know why
- **FYI:** anything you should know — surprise behaviour, perf, deps, etc.

---

## Pre-execution baseline (2026-05-22)

- Starting from commit `a49a18d` (pane size limits 25/75) on `main`. 20 commits, no remote.
- All 69 vitest tests + 11 cargo tests green.
- `npm run typecheck` clean, `cargo fmt --check` + `cargo clippy -D warnings` clean.
- Dev environment: Windows 11, PowerShell 5.1, gh CLI authenticated as `rithwik1510`.
- Working in-place (no worktree). User opted for review-per-phase cadence, not per-task.

---

## Phase 0 — Theme tokens + CSS modules typing

- **FYI:** The plan states to add `import "@/styles/theme.css"` to `src/main.tsx` BEFORE the existing CSS imports (xterm-overrides.css and @xterm/xterm/css/xterm.css). In reality those two CSS imports live in `src/terminals/registry.ts`, not in `main.tsx`. `main.tsx` had no CSS imports at all. The theme import was added as the first line of `main.tsx` as instructed — it loads before `registry.ts` is imported transitively, so load order is preserved.
- **FYI:** Four hex codes in `src/terminals/registry.ts` (`#0a0a0a`, `#e8e8e8`, `#d4a85c`, `#d4a85c33`) were not substituted. These are xterm.js `ITheme` constructor arguments — the Terminal object's internal colour palette, not DOM CSS. CSS variables cannot be read by the xterm.js JS API, so these must remain as raw hex. They were not in the plan's substitution list.
- **FYI:** `grep -RE "#[0-9a-fA-F]{3,6}" src/` after the substitutions reports hits only in `src/styles/theme.css` (the token definitions) and `src/terminals/registry.ts` (xterm ITheme, as noted above). No hits in xterm-overrides.css.

---

## Phase 1 — Bundle Inter + JetBrains Mono

- **FYI:** `npm install` was performed by the controller (not by this agent) because the API was overloaded during initial dispatch. Packages arrived at: `@fontsource-variable/inter@5.2.8`, `@fontsource-variable/jetbrains-mono@5.2.8`.
- **Decision:** Verified that both packages ship an `index.css` entry point before writing `fonts.css`. Directory listing confirmed `index.css` exists in both `node_modules/@fontsource-variable/inter/` and `node_modules/@fontsource-variable/jetbrains-mono/`. The plan's `@import` paths (`@fontsource-variable/inter/index.css` and `@fontsource-variable/jetbrains-mono/index.css`) were used as-is — no deviation needed.
- **FYI:** `registry.ts` `fontFamily` option updated from the hard-coded string `'"JetBrains Mono", Consolas, "Courier New", monospace'` to `getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim() || 'JetBrains Mono Variable, Consolas, monospace'`. This reads the CSS token at Terminal creation time so the xterm instance always mirrors the design token.
- **FYI:** `npm install` reported 6 vulnerabilities. These are pre-existing dev-dependency noise (not blocking, not introduced by this phase).

---

## Phase 2 — Sidebar with file tree, filter, new-file, watcher

_to be filled in_

---

## Phase 3 — Shell auto-detection + per-pane Change Shell menu

_to be filled in_

---

## Phase 4 — MD Quick Viewer Panel with CodeMirror 6

_to be filled in_

---

## Phase 5 — Ctrl+Click MD Link in terminals opens Quick Viewer

_to be filled in_

---

## Phase 6 — MD Editor Full View with Tab Strip + Live Preview pane

_to be filled in_
