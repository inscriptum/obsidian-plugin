// playwright-eval.mjs — run a JS body in the live Obsidian renderer (CDP).
//
// Usage: node local/workflow/scripts/playwright-eval.mjs <body.js> [timeoutMs]
//
// The file's source is evaluated as an expression — write an async IIFE,
// `(async () => { ...; return out; })()`. It runs with awaitPromise and
// returnByValue semantics; the value is printed as JSON.
//
// Requires the dev-only `playwright-core` (repo devDependency, NOT bundled)
// and Obsidian running with --remote-debugging-port=9223.
// See instructions/actions/action-debug-obsidian-cdp.note — Notes section —
// for the native-drag pitfall (do NOT drive native DnD through page.mouse;
// dispatch DOM events from inside the probe instead).
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const file = process.argv[2];
if (file == null) {
  console.error('usage: node playwright-eval.mjs <body.js> [timeoutMs]');
  process.exit(1);
}
const timeoutMs = Number(process.argv[3] ?? 30000);

const body = fs.readFileSync(file, 'utf8');
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223', { timeout: 8000 });
const page = browser
  .contexts()
  .flatMap((context) => context.pages())
  .find((p) => p.url().startsWith('app://obsidian.md'));
if (page == null) {
  await browser.close().catch(() => {});
  throw new Error('Obsidian page not found — is the app running with --remote-debugging-port=9223?');
}
try {
  const value = await page.evaluate(body, undefined, { timeout: timeoutMs });
  if (value !== undefined) {
    console.log(JSON.stringify(value, null, 2));
  }
} finally {
  await browser.close().catch(() => {});
}
