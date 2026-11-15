// cdp-shot-drag.mjs — select a text range with a real mouse drag, then screenshot.
//
// Usage: node scripts/debug/cdp-shot-drag.mjs <out.png> <search-text> [scrollY]
//
// Finds <search-text> inside the active ProseMirror editor of the dev-vault
// window, drags across it with playwright's mouse (user-like selection, the
// bubble menu reacts to it), then captures the window to <out.png>.
import { chromium } from 'playwright-core';

const DEV_VAULT_ROOT = '/Users/d.sumbaev/DEVELOPMENT/inscriptum/obsidian-plugin';
const outPath = process.argv[2];
const searchText = process.argv[3];
if (outPath == null || searchText == null) {
  console.error('usage: node cdp-shot-drag.mjs <out.png> <search-text>');
  process.exit(1);
}

const browser = await chromium.connectOverCDP('http://127.0.0.1:9223', { timeout: 8000 });
const pages = browser
  .contexts()
  .flatMap((c) => c.pages())
  .filter((p) => p.url().startsWith('app://obsidian.md'));
const titled = await Promise.all(pages.map(async (p) => ({ t: await p.title(), p })));
const page = titled.find((x) => x.t.includes('obsidian-plugin'))?.p;
if (!page) throw new Error('dev vault window not found');
try {
  const root = await page.evaluate(() => window.app.vault.adapter.basePath);
  if (root !== DEV_VAULT_ROOT) throw new Error(`wrong vault window: basePath=${root}`);

  const rect = await page.evaluate((needle) => {
    const app = window.app;
    const editor = app.workspace.activeLeaf?.view?.editor;
    const doc = editor.state.doc;
    let from = null;
    let to = null;
    doc.descendants((node, pos) => {
      if (from == null && node.isText && node.text?.includes(needle)) {
        const i = node.text.indexOf(needle);
        from = pos + i;
        to = pos + i + needle.length;
      }
    });
    if (from == null) return null;
    const s = editor.view.domAtPos(from);
    const e = editor.view.domAtPos(to);
    const range = document.createRange();
    range.setStart(s.node, s.offset);
    range.setEnd(e.node, e.offset);
    const r = range.getClientRects()[0];
    return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
  }, searchText);
  if (!rect) throw new Error('text not found in the active editor');

  const y = rect.y + rect.height / 2;
  await page.mouse.move(rect.x + 2, y);
  await page.mouse.down();
  await page.mouse.move(rect.x + rect.width - 2, y, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(900);

  await page.screenshot({ path: outPath });
  console.log(`saved ${outPath}`);
} finally {
  await browser.close().catch(() => {});
}
