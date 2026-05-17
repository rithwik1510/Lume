# Frontend stack: Tauri v2 + React 18 + Vite + Zustand

## Status: accepted

## Context
The Workstation runs multiple Terminal Panes (xterm.js) and a Markdown Editor (CodeMirror 6) inside a desktop shell on Windows. The product's stated goal is "smooth, doesn't break visuals" under heavy output (4+ panes streaming agent output simultaneously). The framework choice is hard to reverse — switching it after v0.1 would mean rewriting all UI code.

## Decision
**Tauri v2 + React 18 + Vite + TypeScript on the front-end, with Zustand as the state library.**

## Considered options

- **React + Vite + Zustand** (chosen): largest ecosystem, best Claude Code fluency (more training data → faster build velocity for a solo developer using CC heavily), proven integration with xterm.js and CodeMirror 6, Zustand's selector pattern gives fine-grained reactivity comparable to Solid.js inside React.
- **Solid.js + Vite**: genuinely cleaner mental model for high-frequency Dashboard updates (no `React.memo` dance), ~2-3x faster on synthetic benchmarks. Rejected because (a) ecosystem is smaller for the UI primitives we need (file tree, drag-resize, etc.), (b) Claude Code is less fluent in Solid (more back-and-forth during builds), (c) the perf win is invisible for our workload — terminal rendering is owned by xterm.js's WebGL renderer, not the framework.
- **Svelte 5 + Vite**: similar arguments to Solid. Rejected for the same reasons.
- **Native Rust UI (egui / iced / GPUI)**: maximally smooth but no xterm.js or CodeMirror 6 equivalent. Rejected as "rewrite the world" — wrong altitude for a weekend-build product.
- **Electron + React**: heavier than Tauri, larger binary, slower cold start, more memory. Rejected because Tauri delivers the same web-tech DX with native-process advantages on Windows.

## Trade-offs accepted

- React requires more discipline around re-render performance than Solid/Svelte (memoization, selector design). The Zustand selector pattern and the data-flow rules in DESIGN.md ("Frontend stack & state architecture") mitigate this.
- Bundle size is marginally larger than Solid/Svelte. Acceptable for a desktop app (Tauri ships a binary, not a web page).

## Consequences

- The state architecture in DESIGN.md (PTY bytes never touch the store, throttled metadata, slice pattern, atomic selectors) is mandatory. Violating it produces the very jank the product was built to avoid.
- xterm.js `Terminal` instances live in a module-level `Map<paneId, Terminal>`, never in Zustand — they're imperative and non-serializable.
- The Dashboard (v0.3) reads from `ptyStore` + `layoutStore` via selectors; it does NOT duplicate pane data into a `dashboardStore`.
