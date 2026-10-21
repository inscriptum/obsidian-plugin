import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import { version } from "./package.json" with { type: "json" };
import { deployPlugin } from "./vite/vite-plugin-deploy.mjs";
import { jsxToTtPlugin } from "./vite/vite-plugin-jsx-to-tt.mjs";

/**
 * Content hash of the sources: the build tag must change whenever the code
 * changes (a plugin update registers fresh custom element classes) but stay
 * the same for the same sources — the community review rebuilds the plugin
 * and compares the result with the released asset, and a timestamp-based
 * tag made every rebuild differ.
 */
function sourceHash(root: string): string {
  const hash = createHash("sha256");
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const full = path.join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        walk(full);
      } else if (/\.(ts|tsx|css|json|mjs|html)$/.test(entry)) {
        hash.update(path.relative(root, full));
        hash.update(readFileSync(full));
      }
    }
  };
  walk(root);
  return hash.digest("hex").slice(0, 8);
}

export default defineConfig(({ mode }) => ({
  plugins: [deployPlugin(), jsxToTtPlugin()],
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    // Suffix for custom element tags (see src/tags.ts): unique per build so
    // plugin reloads/updates register fresh classes. Dev gets a per-build
    // hash so `vite build --watch` reloads also pick up changes fully.
    // Production builds without an explicit INSCRIPTUM_BUILD_TAG get the
    // source hash — deterministic, so the review's rebuild matches the
    // released asset — otherwise a plugin toggle-off/on keeps the OLD
    // classes in the window's CustomElementRegistry and `new ElementClass()`
    // throws (Illegal constructor) for every image/attachment node.
    // ios-debug.mjs passes INSCRIPTUM_BUILD_TAG so a deploy can be verified
    // on-device (shown in the toolbar, logged on note open).
    "process.env.EDITOR_VERSION": JSON.stringify(
      mode === "development"
        ? `${version}-dev-${Date.now().toString(36)}`
        : process.env.INSCRIPTUM_BUILD_TAG
          ? `${version}-${process.env.INSCRIPTUM_BUILD_TAG}`
          : `${version}-${sourceHash(path.resolve(import.meta.dirname, "src"))}`,
    ),
    "process.env.EDITOR_BUILD_TAG": JSON.stringify(
      process.env.INSCRIPTUM_BUILD_TAG ?? "",
    ),
  },
  build: {
    lib: {
      entry: "src/main.ts",
      formats: ["cjs"],
      fileName: () => "main.js",
    },
    cssMinify: "lightningcss",
    rolldownOptions: {
      external: ["obsidian", "electron"],
      output: {
        // One file: the community plugin installer only downloads
        // manifest.json, main.js and styles.css — a chunked build would
        // reach users without its mermaid chunk.
        codeSplitting: false,
        assetFileNames: "styles.css",
      },
    },
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    // Mermaid (~5 MB min) is inlined into the single-file build, so global
    // minification is required to keep main.js shippable (task mermaid-diagrams).
    // The file is above Obsidian Sync's 5 MB limit — see the README note.
    minify: true,
  },
  css: {
    transformer: "lightningcss",
  },
}));
