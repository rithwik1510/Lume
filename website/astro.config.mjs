// @ts-check
import { defineConfig } from "astro/config";

// https://astro.build
export default defineConfig({
  // Update to the real production origin before deploying (used for canonical
  // URLs, sitemap, and Open Graph absolute URLs).
  site: "https://lume.dev",
  build: { inlineStylesheets: "auto" },
  // No interactive islands — the site is fully static. Hide the dev toolbar.
  devToolbar: { enabled: false },
});
