// verify-text-width-caps.mjs — measure text-block widths after removing the
// 60/62/68ch caps in typography-v2.css (task text-width-caps).
//
// Usage: node scripts/debug/verify-text-width-caps.mjs <label> [platform] [um]
//   label    output prefix: JSON/screenshot go to local/text-width-caps-<label>.*
//   platform "android" targets the mobile app over CDP :9224 (npm run
//            android:debug first); default is desktop over CDP :9223.
//   um       open local/test.um (notepad view) instead of the .note specimen;
//            block width exposes a max-width cap even on short text, so the
//            container needs no long content.
//
// Creates local/text-width-caps-verify.note (long paragraph, bullet and
// ordered lists, blockquote), opens it, and reports computed max-width and
// rendered width of p/ul/ol/blockquote against the ProseMirror column width.
// The desktop vault is verified by root path before any interaction
// (rule-verify-vault): the probe iterates all renderer windows and picks the
// one whose vault adapter basePath matches the dev vault.
// Prints one JSON object; screenshot saved as PNG evidence.
import { chromium } from 'playwright-core';
import { devVaultPath } from './dev-vault-path.mjs';

const label = process.argv[2] ?? 'run';
const platform = process.argv[3] === 'android' ? 'android' : 'desktop';
const umMode = process.argv[4] === 'um';

const endpoint = platform === 'android' ? 'http://127.0.0.1:9224' : 'http://127.0.0.1:9223';
const pageUrlPrefix = platform === 'android' ? 'http://localhost/' : 'app://obsidian.md';
const devVault = devVaultPath;

const browser = await chromium.connectOverCDP(endpoint, { timeout: 8000 });
const windows = [];
let page = null;
for (const p of browser.contexts().flatMap((c) => c.pages())) {
  if (!p.url().startsWith(pageUrlPrefix)) continue;
  let id = null;
  try {
    id = await p.evaluate(() => {
      try { return window.app?.vault?.adapter?.basePath ?? window.app?.vault?.getName?.() ?? null; } catch { return null; }
    }, undefined, { timeout: 10000 });
  } catch (e) { id = 'unreachable: ' + String(e).slice(0, 60); }
  windows.push(id);
  // rule-verify-vault: desktop — dev vault by root path; android — the
  // plugin's own TestVault (the established mobile target of verify-* probes)
  if (platform === 'android' ? typeof id === 'string' && id.endsWith('/TestVault') : id === devVault) page = p;
}
if (page == null) {
  console.log(JSON.stringify({ ok: false, error: `target vault window not found on ${endpoint}`, windows }, null, 2));
  process.exit(1);
}

const body = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const vault = app.vault;
  const NOTE = 'local/text-width-caps-verify.note';
  const UM = 'local/test.um';
  let leaf;

  if (${JSON.stringify(umMode)}) {
    const umFile = vault.getAbstractFileByPath(UM);
    if (!umFile) return { ok: false, error: 'no ' + UM };
    leaf = app.workspace.getLeaf('tab');
    await leaf.openFile(umFile);
    app.workspace.setActiveLeaf(leaf, { focus: true });
    await sleep(900);
  } else {
    let n = 0;
    const mkId = () => 'probe' + (n++).toString(36).padStart(7, '0');
    const text = (t) => ({ type: 'text', text: t });
    const para = (t) => ({ type: 'paragraph', attrs: { id: mkId(), align: null }, content: [text(t)] });
    const li = (t) => ({ type: 'listItem', attrs: { id: mkId() }, content: [para(t)] });
    const LONG = 'The quick brown fox jumps over the lazy dog while the calm reader scrolls the wide column of the editor. '.repeat(12);

    const doc = {
      type: 'noteDoc',
      content: [
        { type: 'noteTitle', attrs: { id: mkId() }, content: [text('text-width-caps verify')] },
        para(LONG),
        { type: 'bulletList', attrs: { id: mkId() }, content: [li(LONG), li('short item')] },
        { type: 'orderedList', attrs: { id: mkId() }, content: [li(LONG), li('short item')] },
        { type: 'blockquote', attrs: { id: mkId() }, content: [para(LONG)] },
      ],
    };

    const raw = JSON.stringify(doc, null, 2);
    const existing = vault.getAbstractFileByPath(NOTE);
    if (existing) await vault.modify(existing, raw); else await vault.create(NOTE, raw);

    const file = vault.getAbstractFileByPath(NOTE);
    leaf = app.workspace.getLeaf('tab');
    await leaf.openFile(file);
    app.workspace.setActiveLeaf(leaf, { focus: true });
    await sleep(700);
  }

  const contentEl = leaf.view?.contentEl ?? document.querySelector('.workspace-leaf.mod-active .view-content');
  const pmEl = contentEl?.querySelector('.ProseMirror');
  if (!pmEl) return { ok: false, error: 'ProseMirror not found in opened leaf', viewType: leaf.view?.getViewType?.() ?? null };

  const measure = (el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return { maxWidth: cs.maxWidth, width: Math.round(r.width), right: Math.round(r.right) };
  };

  const out = { ok: true, base: vault.adapter.basePath, platform: ${JSON.stringify(platform)}, mode: ${JSON.stringify(umMode)} ? 'um' : 'note' };
  out.viewType = leaf.view?.getViewType?.() ?? null;
  out.pmColumn = { width: Math.round(pmEl.getBoundingClientRect().width), right: Math.round(pmEl.getBoundingClientRect().right) };
  out.blocks = {};
  for (const sel of ['.note p', '.note ul', '.note ol', '.note blockquote']) {
    const els = [...pmEl.querySelectorAll(sel)].filter((e) => !e.querySelector(sel));
    out.blocks[sel] = els.length ? measure(els[0]) : null;
  }
  // top-level blocks only (direct children of the .note root): the first
  // querySelectorAll('.note p') hit may live inside a table cell or quote
  const root = pmEl.querySelector('.note') ?? pmEl;
  out.rootClass = root.className?.slice(0, 80) ?? null;
  out.topLevel = {};
  for (const tag of ['p', 'ul', 'ol', 'blockquote']) {
    const els = [...root.children].filter((e) => e.tagName.toLowerCase() === tag);
    out.topLevel[tag] = els.length ? measure(els[0]) : null;
  }
  const p = out.topLevel.p ?? out.blocks['.note p'];
  out.pFillsColumn = p ? p.width >= out.pmColumn.width - 4 : false;
  out.umFiles = app.vault.getFiles().filter((f) => f.path.endsWith('.um')).map((f) => f.path).slice(0, 5);
  return out;
})()`;

const value = await page.evaluate(body, undefined, { timeout: 60000 });
console.log(JSON.stringify({ windows, result: value }, null, 2));

// screenshot evidence
try {
  const shotPath = 'local/text-width-caps-' + label + '.png';
  const view = await page.$('.workspace-leaf.mod-active .note-view-container');
  if (view) {
    await view.screenshot({ path: shotPath });
    console.log('screenshot: ' + shotPath);
  }
} catch (e) { console.log('screenshot failed: ' + String(e).slice(0, 120)); }
await browser.close().catch(() => {});
