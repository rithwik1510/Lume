import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    globals: true,
    environment: "happy-dom",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules", "spike-archive", "src-tauri"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
