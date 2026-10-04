// One-off: evaluate a body in the Obsidian renderer and save screenshots.
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const body = fs.readFileSync(process.argv[2], 'utf8');
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223', { timeout: 8000 });
const page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith('app://obsidian.md'));
try {
  const value = await page.evaluate(body, undefined, { timeout: 45000 });
  if (value !== undefined) console.log(JSON.stringify(value, null, 2));
} finally {
  await browser.close().catch(() => {});
}
