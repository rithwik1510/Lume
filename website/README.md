# Lume — marketing site

The Lume landing page, built with **[Astro](https://astro.build)** (static output).
**Fully static — zero framework JS.** The only client-side code is one small vanilla
script (`src/scripts/lume.js`) for the scroll/reveal interactions. Design tokens are lifted
verbatim from the app (`src/styles/theme.css`): cobalt palette, expo-out motion curve,
4/6px radii, hairline `#222` borders, Inter + JetBrains Mono.

## Stack

- **Astro** — static site generator; builds to plain HTML/CSS/JS in `dist/`.
- **@fontsource-variable/{inter,jetbrains-mono}** — self-hosted variable fonts (no
  render-blocking Google Fonts CDN).
- **astro:assets** — the product screenshots are optimized to WebP automatically.

## Structure

```
website/
  astro.config.mjs          # Astro config; set `site` to the prod origin. Dev toolbar disabled.
  src/
    pages/index.astro        # the whole page (nav → hero → tiling → smoothness → markdown → keyboard → themes → spec → CTA → footer)
    styles/lume.css          # all styles + the 4 theme palettes (data-theme) + font pairs (data-font-pair)
    scripts/lume.js          # bundled vanilla interactions: rise-in, hero agent stream, scroll-driven pane split, theme cards, copy button
    assets/                  # app-agents.png, app-markdown.png (optimized at build)
  public/
    favicon.svg              # tiled-pane brand mark
    og.png                   # social/Open Graph image
```

## Commands

```bash
npm install      # once
npm run dev      # local dev server with HMR  → http://localhost:4321
npm run build    # production build → dist/
npm run preview  # serve the built dist/ locally
```

## Deploy

It's a static site, so any host works. No config needed for the major ones:

- **Vercel / Netlify / Cloudflare Pages** — point at this folder; they auto-detect Astro
  (`npm run build`, output `dist/`). Set **Root Directory = `website`** if the repo root
  is the app.
- **GitHub Pages** — use the official `withastro/action`, or push `dist/` to a `gh-pages` branch.

Before going live, set `site` in `astro.config.mjs` to the real origin (used for canonical
URLs and absolute Open Graph image URLs).

## Notes

- **Themes:** the page ships in the default **cobalt** palette. Clicking a palette card in
  the Themes section re-themes the whole page live (for the session). The CSS still defines
  all four palettes and the font pairs via `data-theme` / `data-font-pair` on `<html>`.
- The earlier live **Tweaks** panel (and with it the React dependency) was removed — the site
  is now framework-free.

## Follow-ups

- **Swap the placeholder GitHub URLs** — search `src/pages/index.astro` for
  `https://github.com` and the `git clone https://github.com/lume/lume` line in
  `src/scripts/lume.js`.
