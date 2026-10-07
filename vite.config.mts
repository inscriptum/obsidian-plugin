import { defineConfig } from "vite";
import { version } from "./package.json" with { type: "json" };
import { deployPlugin } from "./vite/vite-plugin-deploy.mjs";
import { jsxToTtPlugin } from "./vite/vite-plugin-jsx-to-tt.mjs";

export default defineConfig(({ mode }) => ({
  plugins: [deployPlugin(), jsxToTtPlugin()],
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    // Suffix for custom element tags (see src/tags.ts): unique per build so
    // plugin reloads/updates register fresh classes. Dev gets a per-build
    // hash so `vite build --watch` reloads also pick up changes fully.
    // Production builds without an explicit INSCRIPTUM_BUILD_TAG get one
    // too — otherwise a plugin toggle-off/on keeps the OLD classes in the
    // window's CustomElementRegistry and `new ElementClass()` throws
    // (Illegal constructor) for every image/attachment node.
    // ios-debug.mjs passes INSCRIPTUM_BUILD_TAG so a deploy can be verified
    // on-device (shown in the toolbar, logged on note open).
    "process.env.EDITOR_VERSION": JSON.stringify(
      mode === "development"
        ? `${version}-dev-${Date.now().toString(36)}`
        : process.env.INSCRIPTUM_BUILD_TAG
          ? `${version}-${process.env.INSCRIPTUM_BUILD_TAG}`
          : `${version}-${Date.now().toString(36)}`,
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
        codeSplitting: false,
        assetFileNames: "styles.css",
      },
    },
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    // Mermaid (~1.3 MB min) is inlined into the single-file build, so global
    // minification is required to keep main.js shippable (task mermaid-diagrams).
    minify: true,
  },
  css: {
    transformer: "lightningcss",
  },
}));
