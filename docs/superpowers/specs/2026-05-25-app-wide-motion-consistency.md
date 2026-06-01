# App-Wide Motion Consistency — Design Spec

**Date:** 2026-05-25
**Status:** Approved (brainstorm) — awaiting plan
**Builds on:** the motion tokens introduced for the sessions-sidebar collapse (`feat(ui): animated sessions sidebar collapse with ease-out motion`).

---

## 1. Goal

One consistent motion language across the entire app. Every transition and every open/close uses the same easing family and a duration scaled to the surface's size. Nothing appears or disappears instantly. The feel target is premium/macOS-grade: an emphasised ease-out (fast start, gentle settle) for things arriving, a slightly quicker ease-in for things leaving.

This is a polish/consistency pass, not new features. It (a) standardises the ad-hoc `80–140ms ease` transitions already scattered across components onto shared tokens, and (b) adds enter/exit motion to the surfaces that currently mount/unmount instantly.

## 2. Motion foundation

`src/styles/theme.css` already defines:

```css
--ease-out: cubic-bezier(0.16, 1, 0.3, 1);        /* expo-out — primary, for enters/opens */
--ease-standard: cubic-bezier(0.32, 0.72, 0, 1);  /* softer alt */
--dur-fast: 120ms;   /* hovers, micro-interactions, exits */
--dur-base: 200ms;   /* overlays, mode swaps, tabs */
--dur-panel: 300ms;  /* large sliding surfaces (sidebar, drawers, dock) */
```

**Addition:**

```css
--ease-in: cubic-bezier(0.4, 0, 1, 1);  /* accelerate-out — for exits (leave a touch quicker than arrive) */
```

**Rule going forward:** new/updated component CSS uses these tokens, never raw `120ms ease`.

## 3. Surface inventory & per-category treatment

| # | Category | Surfaces | Motion | Tokens |
|---|---|---|---|---|
| 1 | **Micro** (hover/focus/active) | TopBar buttons, SessionRow, SessionGroup (header/caret/add), SessionsSidebar buttons, ConfirmDialog buttons, MdEditor pen button, QuickViewer icon button, ShortcutsModal/ContextMenu/SplitMenu items, MdEditor tab buttons | tokenize existing `80/100/120/140ms ease` → consistent | `--dur-fast` + `--ease-out` |
| 2 | **Panels/drawers** (slide) | Sessions sidebar (DONE) · File Drawer · Quick Viewer dock | width/transform slide in & out | `--dur-panel` + `--ease-out` (exit `--ease-in`) |
| 3 | **Mode swap** | MD-Editor full-view ↔ terminal central area | cross-fade + subtle slide | `--dur-base` + `--ease-out` |
| 4 | **Overlays — modals** | ConfirmDialog, ShortcutsModal | backdrop opacity fade; body fade + scale `0.97 → 1` (enter), fade + scale `1 → 0.98` (exit, quicker) | enter `--dur-base`/`--ease-out`; exit `--dur-fast`/`--ease-in` |
| 5 | **Overlays — popovers** | SplitMenu, ContextMenu | fade + scale `0.96 → 1` from the anchor point (`transform-origin` set to the trigger corner) | enter `--dur-fast`/`--ease-out`; exit `--dur-fast`/`--ease-in` |
| 6 | **Toasts** | Toaster | tokenize existing slide-in; ADD slide-out + fade on dismiss | enter `--dur-base`; exit `--dur-fast` |
| 7 | **Tabs** | MD-Editor tab strip | active-tab indicator slides between tabs; tab open/close fade | `--dur-base` + `--ease-out` |

Decided in brainstorm: overlays (categories 4 & 5) use **subtle scale + fade**, not pure fade or slide.

## 4. The presence mechanism (`usePresence`)

**Problem:** Most overlays/panels (ConfirmDialog, ShortcutsModal, SplitMenu, ContextMenu, Quick Viewer, File Drawer) `return null` / conditionally mount when closed. They can animate *in* (mount) but vanish *instantly* on close (unmount happens before any exit transition can run).

**Solution:** a tiny shared hook that keeps a component mounted through its exit animation, then unmounts. No new dependencies.

```ts
// src/hooks/usePresence.ts
//
// Keeps `children` mounted through an exit animation when `open` flips false.
// Returns { mounted, state }:
//   - mounted: whether to render at all
//   - state: "open" | "closed" — drive CSS via data-state, transition on it
//
// On open=true:  mounted=true immediately; state starts "closed" then flips to
//   "open" on the next frame so the enter transition runs from the closed styles.
// On open=false: state flips to "closed" (exit transition runs); after
//   `exitMs` (or transitionend) mounted flips false and the node unmounts.
// Honors prefers-reduced-motion (collapses to instant).

interface PresenceState {
  mounted: boolean;
  state: "open" | "closed";
}
export function usePresence(open: boolean, exitMs?: number): PresenceState;
```

**Consumer pattern:**

```tsx
const { mounted, state } = usePresence(open, 120);
if (!mounted) return null;
return <div data-state={state} className={styles.overlay}>…</div>;
```

```css
.overlay { opacity: 1; transform: scale(1); transition: opacity var(--dur-base) var(--ease-out), transform var(--dur-base) var(--ease-out); }
.overlay[data-state="closed"] { opacity: 0; transform: scale(0.97); transition-duration: var(--dur-fast); transition-timing-function: var(--ease-in); }
```

`exitMs` defaults to `--dur-fast` (120ms) so the unmount timer matches the exit transition. Components needing the panel duration pass it explicitly.

This single hook standardises enter/exit for every mount/unmount surface — that's what makes the motion *consistent* rather than each component hand-rolling it.

## 5. Reduced motion

A single global rule (in `theme.css` or a global stylesheet) honors the OS setting app-wide:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    transition-duration: 0.01ms !important;
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
  }
}
```

`usePresence` also checks `prefers-reduced-motion` and uses a near-zero exit timer so unmount is effectively immediate. The sidebar's existing per-component reduced-motion rule can be removed in favour of this global one.

## 6. Per-surface implementation notes

- **Micro (1):** pure CSS — replace literal durations/easings with tokens in each `.module.css`. No JS.
- **File Drawer (2):** currently `return null` when closed. Give it the sessions-sidebar treatment — always-mountable shell that width-animates 240→0, content right-anchored + clipped, gated through `resizeBus` during the slide (the file tree itself doesn't need fit-gating, but the adjacent terminal area does, same as the sidebar). Reuse the sidebar's approach.
- **Quick Viewer (2):** lives in App.tsx's right PanelGroup, conditionally rendered. Animate its width/transform on open/close; gate the terminal fit via `resizeBus` for the duration (the left Panel resizes).
- **Mode swap (3):** App.tsx swaps `<MdEditor/>` and the PaneTree PanelGroup on `mdMode`. Cross-fade the outgoing/incoming via `usePresence` on each, or a simple keyed fade. Keep it light (no layout thrash on the terminal — gate via resizeBus if the terminal area resizes).
- **Modals (4):** ConfirmDialog + ShortcutsModal adopt `usePresence`; backdrop fades, body scales+fades. Preserve existing focus management (ConfirmDialog's focus-on-open effect) — fire it when state becomes "open".
- **Popovers (5):** SplitMenu + ContextMenu adopt `usePresence`; set `transform-origin` to the anchor. Preserve existing click-outside/escape close behavior — closing sets open=false, the hook plays the exit.
- **Toaster (6):** per-toast exit — when a toast is dismissed/auto-expires, play exit before removal. Either lift `usePresence` per toast item or add a brief "leaving" state in toastStore. Keep MAX_VISIBLE + timing behavior intact.
- **Tabs (7):** active-indicator as an absolutely-positioned underline that transitions `left/width` between active tabs; tab mount/unmount fade.

## 7. Non-goals

- No new animation library (framer-motion etc.) — CSS + the small `usePresence` hook only.
- No new *kinds* of motion beyond what's listed (no parallax, no spring physics, no page-level route transitions).
- No redesign of layouts, colors, or component structure — motion only.
- Terminal/xterm rendering internals unchanged (we only gate `fit()` during adjacent resizes, as already established).
- `--ease-standard` stays available but is not retrofitted onto existing surfaces in this pass.

## 8. Sequencing (phases)

Each phase ends in a review gate, grouped so each is independently shippable and verifiable:

1. **Foundation** — add `--ease-in`, the global reduced-motion rule, and `usePresence` (+ its unit test). Remove the sidebar's local reduced-motion rule.
2. **Micro tokenization** — replace all ad-hoc hover/focus transitions with tokens. Pure CSS, low risk, immediate consistency win.
3. **Overlays — modals** — ConfirmDialog, ShortcutsModal via `usePresence` (scale+fade), preserving focus management.
4. **Overlays — popovers** — SplitMenu, ContextMenu via `usePresence` (scale+fade from anchor), preserving click-outside/escape.
5. **Toaster** — enter tokenized + exit added.
6. **Panels** — File Drawer slide + Quick Viewer dock slide (resizeBus-gated).
7. **Mode swap + tabs** — MD-editor full-view cross-fade; tab-strip active indicator + open/close.

## 9. Testing

- `usePresence`: unit test the mount→open→close→unmount lifecycle and the reduced-motion path (fake timers).
- Component render tests where they already exist (TopBar, SessionsSidebar) must stay green; add a render assertion for any overlay that gains a `data-state`.
- Motion *feel* is verified live (`npm run tauri dev`) per phase — not unit-testable.

## 10. References

- Sidebar motion precedent: `src/components/SessionsSidebar.{tsx,module.css}`, `src/styles/theme.css` motion tokens.
- `resizeBus` (xterm fit gating during adjacent resizes): `src/components/resizeBus.ts`.
- Brainstorm Q&A: 2026-05-25 (overlay enter = subtle scale + fade).
