// Builds the browser harness bundle (src/browser-harness/harness.ts) into
// dist-harness/harness.js so Playwright MCP can drive the real editor with
// real layout (the jsdom tests have no layout, so the gutter drag flow —
// blockByVerticalLookup, posAtCoords(null) zones — is never exercised).
//
// Usage: node scripts/build-harness.mjs
import { build } from 'vite';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { jsxToTtPlugin } from '../vite/vite-plugin-jsx-to-tt.mts';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Minimal `obsidian` module shim: src/texto only imports Platform from it
// (isiOS/isMacOS helpers). Everything else the editor core needs is DOM
// globals (createDiv etc.), injected by the harness itself.
const obsidianShim = path.join(root, 'src/browser-harness/obsidian-shim.js');
fs.mkdirSync(path.dirname(obsidianShim), { recursive: true });
fs.writeFileSync(
  obsidianShim,
  'export const Platform = { isIosApp: false, isMacOS: true, isMobile: false, isMobileApp: false };\n' +
  'export const moment = () => ({});\n',
);

await build({
  configFile: false,
  root,
  logLevel: 'warn',
  plugins: [jsxToTtPlugin()],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'process.env.EDITOR_VERSION': JSON.stringify('harness'),
  },
  resolve: {
    alias: [{ find: /^obsidian$/, replacement: obsidianShim }],
  },
  build: {
    outDir: 'dist-harness',
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
    lib: {
      entry: path.join(root, 'src/browser-harness/harness.ts'),
      formats: ['es'],
      fileName: () => 'harness.js',
    },
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
});

// The harness CSS: build the same import chain vite uses for the plugin
// (editor.css pulls the rest) so @imports get inlined with correct paths.
import { readFileSync } from 'node:fs';
const editorCss = path.join(root, 'src/styles/editor.css');
await build({
  configFile: false,
  root,
  logLevel: 'warn',
  plugins: [jsxToTtPlugin()],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'process.env.EDITOR_VERSION': JSON.stringify('harness'),
  },
  resolve: {
    alias: [{ find: /^obsidian$/, replacement: obsidianShim }],
  },
  build: {
    outDir: 'dist-harness-css',
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      input: { css: editorCss },
      output: { assetFileNames: 'styles.css' },
    },
  },
});
fs.renameSync(
  path.join(root, 'dist-harness-css/styles.css'),
  path.join(root, 'dist-harness/styles.css'),
);
fs.rmSync(path.join(root, 'dist-harness-css'), { recursive: true, force: true });
void readFileSync;
console.log('harness built: dist-harness/harness.js + styles.css');
