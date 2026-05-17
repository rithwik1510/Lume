# Markdown editing lives outside the tiling grid

## Status: accepted

## Context
A natural early design was: markdown is just another Pane Content type alongside Terminal, mounted in the same tiling grid. Users would split a Pane and pick Terminal or Markdown Editor — the layout tree handles both uniformly.

We rejected that model in /grill-with-docs after the user articulated a different mental model: the Tiling Area is for terminals only; markdown gets its own surfaces.

## Decision
Markdown is **not** a Pane Content type. It lives in two separate surfaces:

1. **MD Editor (Full View)** — a top-level mode of the Workstation, toggled by Ctrl+E. When active, the Tiling Area + Quick Viewer are hidden; a full-width CodeMirror 6 editor with its own tab strip occupies the central area. Has its own OS file picker (Ctrl+O), can open any file on disk.
2. **MD Quick Viewer** — a right-side resizable Panel that opens alongside the Tiling Area. Default 25% width. Opens via clicking an `.md` file in the Sidebar, Ctrl+Click on an MD Link in a Terminal Pane, the top-bar Quick Viewer toggle icon, or Ctrl+Shift+M.

The Tiling Area only ever holds Terminal Panes (and Dashboard Panes in v0.3+).

## Considered options

- **MD as a Pane Content type (rejected):** maximum layout flexibility — users could have arbitrary mixes of terminals and markdown in the same grid. Cleanest from a data-model standpoint (one Pane abstraction, multiple content types).
- **MD as separate top-level mode + side panel (chosen):** matches the user's actual workflow — terminals always run alongside markdown; markdown is either "I'm reading what an agent wrote" (Quick Viewer) or "I'm deeply editing docs from a colleague" (Full View). Neither use case wants markdown jammed into a 4-pane tile next to Claude Code.

## Trade-offs accepted

- **Less flexible layout.** Users cannot put a markdown pane next to a terminal pane within the tiling grid. The Quick Viewer pattern (right-side panel) is the only way to see markdown alongside terminals — limited to one file at a time.
- **Two MD editing surfaces with their own state** instead of one unified pane abstraction. The Full View and Quick Viewer each have their own CodeMirror 6 instance. The Full View's open-tabs state is separate from whatever file is currently in the Quick Viewer. We pay this complexity to get the right UX.
- **The Layout binary-tree data model becomes simpler** — Pane Content is just `Terminal | Dashboard` in v0.3, never `Markdown`. Markdown lives in a `mdStore` with its own shape (open tabs array, active tab id, mode toggle state).

## Consequences

- The Tiling Area only renders Terminal Panes (v0.1) and Dashboard Panes (v0.3).
- A user wanting to read a markdown file while terminals are running uses the Quick Viewer (~25% right Panel), not a split pane.
- A user wanting to deeply edit markdown enters Full View mode (Ctrl+E); the Tiling Area is hidden but terminals keep running in the background.
- The Full View's tab strip is independent of any future Workstation Tab Strip (v0.2). Two unrelated tab concepts in the product, named distinctly: **Workstation Tabs** (v0.2+) vs **MD Editor Tabs** (open MD files inside Full View).
