// @ts-check
import { defineConfig } from "astro/config";

// https://astro.build
export default defineConfig({
  // Production origin (used for canonical URLs, sitemap, and Open Graph absolute
  // URLs). Update if a custom domain is attached.
  site: "https://lume-gold-pi.vercel.app",
  build: { inlineStylesheets: "auto" },
  // No interactive islands — the site is fully static. Hide the dev toolbar.
  devToolbar: { enabled: false },
});
