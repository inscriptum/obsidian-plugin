import fs from 'node:fs';
import { chromium } from 'playwright-core';
const body = fs.readFileSync(process.argv[2], 'utf8');
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223', { timeout: 8000 });
const pages = browser.contexts().flatMap((c) => c.pages()).filter((p) => p.url().startsWith('app://obsidian.md'));
const titled = await Promise.all(pages.map(async (p) => ({ t: await p.title(), p })));
const chosen = titled.find((x) => x.t.includes('obsidian-plugin'))?.p;
if (!chosen) { console.error(JSON.stringify(titled.map((x) => x.t))); process.exit(1); }
const value = await chosen.evaluate(body, undefined, { timeout: 30000 });
if (value !== undefined) console.log(JSON.stringify(value, null, 2));
await browser.close().catch(() => {});
