import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { jsxToTtPlugin } from "./vite/vite-plugin-jsx-to-tt.mjs";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [jsxToTtPlugin()],
  resolve: {
    alias: {
      // The `obsidian` module only exists inside the Obsidian runtime; tests
      // use the manual mock instead (see src/__mocks__/obsidian.ts).
      obsidian: path.resolve(rootDir, "src/__mocks__/obsidian.ts"),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["vitest.setup.ts"],
    // Playwright specs in tests/e2e run through `npm run test:e2e`
    // (real Chromium), not under vitest.
    exclude: ["**/node_modules/**", "**/dist/**", "tests/e2e/**"],
  },
});
