// cdp-shot.mjs — evaluate a JS body in the dev-vault Obsidian window, then save a screenshot.
//
// Usage: node scripts/debug/cdp-shot.mjs <body.js> <out.png> [--wait <ms>]
//
// The body is an async IIFE source (see playwright-eval.mjs). It runs in the
// window whose vault root matches the configured dev vault. After the body resolves, the window is captured
// to <out.png> (viewport screenshot, like the user sees it).
import fs from 'node:fs';
import { chromium } from 'playwright-core';
import { devVaultPath } from './dev-vault-path.mjs';

const DEV_VAULT_ROOT = devVaultPath;

const bodyPath = process.argv[2];
const outPath = process.argv[3];
const waitIdx = process.argv.indexOf('--wait');
const waitMs = waitIdx >= 0 ? Number(process.argv[waitIdx + 1]) : 700;
if (bodyPath == null || outPath == null) {
  console.error('usage: node cdp-shot.mjs <body.js> <out.png> [--wait <ms>]');
  process.exit(1);
}

const body = fs.readFileSync(bodyPath, 'utf8');
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223', { timeout: 8000 });
const pages = browser
  .contexts()
  .flatMap((c) => c.pages())
  .filter((p) => p.url().startsWith('app://obsidian.md'));
let chosen;
for (const p of pages) {
  const root = await p.evaluate(() => window.app?.vault?.adapter?.basePath ?? null).catch(() => null);
  if (root === DEV_VAULT_ROOT) { chosen = p; break; }
}
if (!chosen) {
  await browser.close().catch(() => {});
  throw new Error('dev vault window not found');
}
try {
  // rule-verify-vault: verify the vault root path, not the name.
  const root = await chosen.evaluate(() => window.app.vault.adapter.basePath);
  if (root !== DEV_VAULT_ROOT) {
    throw new Error(`wrong vault window: basePath=${root}`);
  }
  const value = await chosen.evaluate(body, undefined, { timeout: 45000 });
  if (value !== undefined) console.log(JSON.stringify(value, null, 2));
  await chosen.waitForTimeout(waitMs);
  await chosen.screenshot({ path: outPath });
  console.log(`saved ${outPath}`);
} finally {
  await browser.close().catch(() => {});
}
