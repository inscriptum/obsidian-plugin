// harness-probe.mjs — run a JS body in the local harness page (playwright-core).
// Usage: node harness-probe.mjs <body.js> [timeoutMs]
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const file = process.argv[2];
if (file == null) {
  console.error('usage: node harness-probe.mjs <body.js> [timeoutMs]');
  process.exit(1);
}
const timeoutMs = Number(process.argv[3] ?? 30000);
const body = fs.readFileSync(file, 'utf8');

const browser = await chromium.launch({
  headless: true,
  executablePath: '/Applications/Chromium.app/Contents/MacOS/Chromium',
});
const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
try {
  await page.goto('http://localhost:8791/.harness/index.html');
  await page.waitForFunction(() => window.__harness != null && window.__harness.view != null, null, { timeout: 15000 });
  await page.waitForTimeout(400);
  const value = await page.evaluate(body, undefined, { timeout: timeoutMs });
  console.log(JSON.stringify(value, null, 2));
} finally {
  await browser.close().catch(() => {});
}
