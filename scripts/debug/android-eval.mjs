// android-eval.mjs — run a JS body in the live Obsidian MOBILE renderer (CDP over adb).
//
// Usage: node local/workflow/scripts/android-eval.mjs <body.js> [timeoutMs]
//
// Same semantics as playwright-eval.mjs (async IIFE, awaitPromise, returnByValue,
// JSON output), but targets the Android WebView tunnel that `npm run android:debug`
// prints (default http://127.0.0.1:9224). The Obsidian mobile page URL is
// `http://localhost/` (not app://obsidian.md).
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const file = process.argv[2];
if (file == null) {
  console.error('usage: node android-eval.mjs <body.js> [timeoutMs]');
  process.exit(1);
}
const timeoutMs = Number(process.argv[3] ?? 30000);
const endpoint = process.env.ANDROID_CDP ?? 'http://127.0.0.1:9224';

const body = fs.readFileSync(file, 'utf8');
const browser = await chromium.connectOverCDP(endpoint, { timeout: 8000 });
const page = browser
  .contexts()
  .flatMap((context) => context.pages())
  .find((p) => p.url().startsWith('http://localhost/'));
if (page == null) {
  await browser.close().catch(() => {});
  throw new Error('Obsidian mobile page not found — run npm run android:debug first?');
}
try {
  const value = await page.evaluate(body, undefined, { timeout: timeoutMs });
  if (value !== undefined) {
    console.log(JSON.stringify(value, null, 2));
  }
} finally {
  await browser.close().catch(() => {});
}
