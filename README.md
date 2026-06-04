# Lume

> Smooth tiled terminals + markdown editor on the desktop. Built to host
> multiple AI coding agents in parallel without breaking visually.

**Status:** v0.1.0-beta.1 — public Windows beta.

## Install (Windows)

**Easiest — one command** (needs Node 18+):

```bash
npx lume-desktop
```

**Direct download:** grab `Lume_<version>_x64-setup.exe` from the
[Releases page](https://github.com/rithwik1510/Workflow/releases) and run it.

The installer is **unsigned** during the beta, so Windows SmartScreen shows
"Windows protected your PC." Click **More info → Run anyway**. It installs to
your user profile (no admin needed) and auto-updates itself from then on.

Windows 11 ships the WebView2 runtime Lume needs. On older Windows 10 machines
without it, install the
[Evergreen WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)
first.

macOS and Linux are not in the beta yet.

## What this is

A Tauri v2 desktop app that combines:

- **Tiled Terminal Panes** (xterm.js + WebGL renderer, real PTYs via
  `portable-pty`). Designed not to tear under heavy agent output.
- **Markdown Editor** (CodeMirror 6) with a side-by-side preview pane.
- **Quick Viewer Panel** for reading `.md` files alongside terminals.

The full design and rationale lives in [`DESIGN.md`](./DESIGN.md). The
domain glossary is in [`CONTEXT.md`](./CONTEXT.md). Strategic decisions
are logged in [`CEO-REVIEW.md`](./CEO-REVIEW.md). Architecture decisions
are under [`docs/adr/`](./docs/adr/).

## Stack

| Layer | Choice |
|---|---|
| Desktop shell | Tauri v2 (Rust host + WebView2 on Windows) |
| Front-end | React 18 + Vite + TypeScript |
| State | Zustand + Immer + devtools (slices, atomic selectors) |
| Terminals | xterm.js + `@xterm/addon-webgl` + `@xterm/addon-fit` |
| PTY | `portable-pty` (Rust) with 32 ms batched IPC + 8 MB ring buffer |
| Markdown | CodeMirror 6 (editor) + `markdown-it` + DOMPurify (preview) |
| Persistence | `@tauri-apps/plugin-store` |

See [`docs/adr/0001-frontend-stack.md`](./docs/adr/0001-frontend-stack.md)
for the rationale.

## Build & run

Requirements (Windows 11):

- Rust stable (`rustup`)
- Node.js 20+
- Visual Studio Build Tools with the "Desktop development with C++"
  workload
- WebView2 runtime (ships with Windows 11)

```pwsh
npm install
npm run tauri dev
```

## Test

```pwsh
npm test               # vitest
npm run typecheck      # tsc --noEmit
cd src-tauri
cargo test --lib       # Rust unit tests
cargo clippy --all-targets -- -D warnings
cargo fmt --all -- --check
```

CI runs the same set on `windows-latest` for every push to `main`
(see [`.github/workflows/ci.yml`](./.github/workflows/ci.yml)).

## Project layout

```
src/                  React + Zustand front-end
  components/         TerminalPane and friends
  store/              Zustand slices (layoutStore, ptyStore, throttle)
  terminals/          Module-level Terminal registry + PTY orchestrator
  types/              Shared types (mirror Rust enums)
src-tauri/            Rust host
  src/
    error.rs          AppError thiserror enum (mirrors TS AppError)
    pty.rs            PTY commands, ring buffer, batched IPC
    lib.rs            Tauri Builder entry
  capabilities/       Tauri v2 capability declarations
  tauri.conf.json     App config
docs/adr/             Architecture Decision Records
spike-archive/        Weekend 0 spike source (preserved for reference)
```

## License

MIT — see [`LICENSE`](./LICENSE).
