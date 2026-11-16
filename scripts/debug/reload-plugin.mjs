// reload-plugin.mjs — disable/enable the inscriptum plugin in the running
// Obsidian renderer after a bundle change (action-debug-obsidian-cdp step 6).
//
// Usage: node scripts/debug/reload-plugin.mjs [platform]
//   platform "android" targets the mobile app over CDP :9224; default is
//   desktop over CDP :9223.
//
// The vault is verified by root path before the reload (rule-verify-vault):
// the probe iterates all renderer windows and picks the dev vault window;
// other vault windows are never touched.
import { chromium } from 'playwright-core';

const platform = process.argv[2] === 'android' ? 'android' : 'desktop';
const endpoint = platform === 'android' ? 'http://127.0.0.1:9224' : 'http://127.0.0.1:9223';
const pageUrlPrefix = platform === 'android' ? 'http://localhost/' : 'app://obsidian.md';
const devVault = '/Users/d.sumbaev/DEVELOPMENT/inscriptum/obsidian-plugin';

const browser = await chromium.connectOverCDP(endpoint, { timeout: 8000 });
const windows = [];
let page = null;
for (const p of browser.contexts().flatMap((c) => c.pages())) {
  if (!p.url().startsWith(pageUrlPrefix)) continue;
  let base = null;
  try {
    base = await p.evaluate(() => { try { return window.app?.vault?.adapter?.basePath ?? null; } catch { return null; } }, undefined, { timeout: 10000 });
  } catch (e) { base = 'unreachable: ' + String(e).slice(0, 60); }
  windows.push(base);
  // rule-verify-vault: desktop — dev vault by root path; android — the
  // plugin's own TestVault (the established mobile target of verify-* probes)
  if (platform === 'android' ? typeof base === 'string' && base.endsWith('/TestVault') : base === devVault) page = p;
}
if (page == null) {
  console.log(JSON.stringify({ ok: false, error: 'dev vault window not found', windows }, null, 2));
  process.exit(1);
}
const value = await page.evaluate(`(async () => {
  await app.plugins.disablePlugin('inscriptum');
  await app.plugins.enablePlugin('inscriptum');
  return { ok: true, reloaded: true, enabled: app.plugins.enabledPlugins.has('inscriptum') };
})()`, undefined, { timeout: 30000 });
console.log(JSON.stringify({ windows, ...value }, null, 2));
await browser.close().catch(() => {});
