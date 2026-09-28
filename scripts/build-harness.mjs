// Builds the browser harness bundle (src/browser-harness/harness.ts) into
// dist-harness/harness.js so Playwright MCP can drive the real editor with
// real layout (the jsdom tests have no layout, so the gutter drag flow —
// blockByVerticalLookup, posAtCoords(null) zones — is never exercised).
//
// Usage: node scripts/build-harness.mjs
import { build } from "vite";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { jsxToTtPlugin } from "../vite/vite-plugin-jsx-to-tt.mts";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Minimal `obsidian` module shim: src/texto only imports Platform from it
// (isiOS/isMacOS helpers). Everything else the editor core needs is DOM
// globals (createDiv etc.), injected by the harness entry. Generated into
// .harness/ (gitignored scratch), NOT src/ — eslint/tsc scan src/**.
// The notepad harness (window.__e2eNotepad) additionally mounts the real
// NotepadView, whose import graph needs the storage-facing classes too —
// stubs are enough: construct+render only, onOpen's vault wiring is not
// exercised and save timers land in the no-op fake adapter.
const obsidianShim = path.join(root, ".harness/obsidian-shim.js");
fs.mkdirSync(path.dirname(obsidianShim), { recursive: true });
fs.writeFileSync(
  obsidianShim,
  [
    "export const Platform = { isIosApp: false, isMacOS: true, isMobile: false, isMobileApp: false, isPhone: false, isTablet: false };",
    "export const moment = () => ({});",
    "export function normalizePath(p) { return p; }",
    "export class TFile { constructor() { this.path = ''; this.name = ''; this.basename = ''; this.extension = ''; this.parent = null; this.vault = null; } }",
    "export class TFolder { constructor() { this.path = ''; this.name = ''; this.parent = null; this.children = []; } }",
    "export class DataAdapter { async read() { return ''; } async readBinary() { return new Uint8Array(); } async write() {} async writeBinary() {} async append() {} async exists() { return false; } async stat() { return null; } async mkdir() {} async rename() {} async remove() {} getFullPath(p) { return p; } }",
    "export class Vault { constructor() { this.adapter = new DataAdapter(); } on() { return () => {}; } getName() { return 'harness'; } }",
    "export class WorkspaceLeaf { constructor() { this.view = null; } }",
    "export class App {}",
    "export class View { constructor(leaf) { this.leaf = leaf; this.app = null; this.navigation = true; this.contentEl = document.createElement('div'); } onLoad() {} onUnload() {} }",
    "export class FileView extends View { get vault() { return this.app ? this.app.vault : null; } }",
    "export class Modal { constructor(app) { this.app = app; this.modalEl = document.createElement('div'); this.titleEl = document.createElement('div'); this.contentEl = document.createElement('div'); } open() {} close() {} onOpen() {} onClose() {} }",
    "export class Notice { constructor(message) { this.message = message; } hide() {} setMessage() { return this; } }",
    "export class Menu { constructor() { this.items = []; } addItem(cb) { const item = { setTitle() { return item; }, setIcon() { return item; }, setDisabled() { return item; }, onClick() { return item; } }; cb(item); this.items.push(item); return this; } addSeparator() { return this; } showAtMouseEvent() {} showAtPosition() {} hide() {} }",
    "export class Setting { constructor(containerEl) { this.containerEl = containerEl; this.controlEl = document.createElement('div'); this.nameEl = document.createElement('div'); this.descEl = document.createElement('div'); } setName() { return this; } setDesc() { return this; } setClass() { return this; } addText(cb) { const c = { inputEl: document.createElement('input'), setValue() { return c; }, setPlaceholder() { return c; }, onChange() { return c; } }; cb(c); return this; } addToggle(cb) { const c = { toggleEl: document.createElement('div'), setValue() { return c; }, onChange() { return c; } }; cb(c); return this; } addButton(cb) { const c = { buttonEl: document.createElement('button'), setCta() { return c; }, onClick() { return c; } }; cb(c); return this; } }",
    "export function setIcon(el, name) { el.textContent = ''; el.dataset.icon = name; }",
    "",
  ].join("\n"),
);

await build({
  configFile: false,
  root,
  logLevel: "warn",
  plugins: [jsxToTtPlugin()],
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    "process.env.EDITOR_VERSION": JSON.stringify("harness"),
    // src/tags.ts reads this too — without the define the bundle keeps a
    // bare `process.env.EDITOR_BUILD_TAG` and throws in the browser.
    "process.env.EDITOR_BUILD_TAG": JSON.stringify(""),
  },
  resolve: {
    alias: [{ find: /^obsidian$/, replacement: obsidianShim }],
  },
  build: {
    outDir: "dist-harness",
    emptyOutDir: true,
    minify: false,
    sourcemap: false,
    lib: {
      entry: path.join(root, "src/browser-harness/harness.ts"),
      formats: ["es"],
      fileName: () => "harness.js",
    },
    rollupOptions: {
      output: { inlineDynamicImports: true },
    },
  },
});

// The harness CSS: build the same import chain vite uses for the plugin
// (editor.css pulls the rest) so @imports get inlined with correct paths,
// plus notepad.css — NotepadView imports it from TS, which the CSS-only
// entry chain never reaches.
import { readFileSync } from "node:fs";
const cssEntry = path.join(root, ".harness/harness.css");
fs.writeFileSync(
  cssEntry,
  '@import "../src/styles/editor.css";\n@import "../src/styles/notepad.css";\n',
);
await build({
  configFile: false,
  root,
  logLevel: "warn",
  plugins: [jsxToTtPlugin()],
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
    "process.env.EDITOR_VERSION": JSON.stringify("harness"),
    "process.env.EDITOR_BUILD_TAG": JSON.stringify(""),
  },
  resolve: {
    alias: [{ find: /^obsidian$/, replacement: obsidianShim }],
  },
  build: {
    outDir: "dist-harness-css",
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      input: { css: cssEntry },
      output: { assetFileNames: "styles.css" },
    },
  },
});
fs.renameSync(
  path.join(root, "dist-harness-css/styles.css"),
  path.join(root, "dist-harness/styles.css"),
);
fs.rmSync(path.join(root, "dist-harness-css"), {
  recursive: true,
  force: true,
});
void readFileSync;
console.log("harness built: dist-harness/harness.js + styles.css");
