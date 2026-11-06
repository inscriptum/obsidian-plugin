// Android verification for the table-resize-edge-swipe task: a resize drag
// on the first/last column of a full-width table must change the width and
// must not hand the gesture to the Obsidian shell (drawer swipe).
//
// Stages (driven from the shell; the touch itself runs through
// scripts/debug/android-touch.mjs between the stages):
//   node verify-table-resize-swipe.mjs setup   — write+open the test note,
//                                                dump the cell rect to long-press
//   node verify-table-resize-swipe.mjs select  — dump handle rects +
//                                                data-ignore-swipe state
//   node verify-table-resize-swipe.mjs check   — dump width / drawer state
//                                                after the drag
// Usage in Result: see issues/table-resize-edge-swipe.
import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';

const stage = process.argv[2] ?? 'setup';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9224', { timeout: 10000 });
const page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith('http://localhost/'));
if (page == null) throw new Error('Android Obsidian page not found');

const NOTE_PATH = `local/table-resize-swipe-verify-${Date.now()}.note`;
// ~full-width 3-col table: 133+133+134 = 400 px against a 411 px screen
const COLWIDTHS = [133, 133, 134];

const R = {};
R.stage = stage;
R.vault = await page.evaluate(() => window.app?.vault?.getName?.() ?? null);
R.errors = [];
page.on('pageerror', (e) => R.errors.push(String(e)));

if (stage === 'setup') {
  R.setup = await page.evaluate(async ([notePath, colwidths]) => {
    const cell = (type, text, colwidth) => ({
      type,
      attrs: { colspan: 1, rowspan: 1, colwidth },
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    });
    const row = (type, texts) => ({
      type: 'tableRow',
      content: texts.map((t, i) => cell(type, t, [colwidths[i]])),
    });
    const doc = {
      type: 'noteDoc',
      content: [
        { type: 'noteTitle', content: [{ type: 'text', text: 'table-resize-swipe-verify' }] },
        {
          type: 'table',
          attrs: { data: { rowsCount: 3, colsCount: 3 } },
          content: [
            row('tableHeader', ['A0', 'A1', 'A2']),
            row('tableCell', ['B0', 'B1', 'B2']),
            row('tableCell', ['C0', 'C1', 'C2']),
          ],
        },
      ],
    };
    await app.vault.adapter.write(notePath, JSON.stringify(doc));
    const file = app.vault.getAbstractFileByPath(notePath);
    const leaf = app.workspace.getLeaf('tab');
    await leaf.openFile(file);
    app.workspace.revealLeaf(leaf);
    await new Promise((r) => setTimeout(r, 800));
    const ed = leaf.view?.editor;
    if (!ed) return { err: 'no editor' };
    window.__ed = ed;
    const cellEl = document.querySelector('.note-view-container.is-mobile table td');
    const rect = cellEl?.getBoundingClientRect();
    return {
      ok: true,
      cellRect: rect ? { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) } : null,
      screen: { w: window.innerWidth, h: window.innerHeight },
      build: window.__inscriptumBuild ?? document.querySelector('inscriptum-note')?.tagName ?? null,
    };
  }, [NOTE_PATH, COLWIDTHS]);
  R.build = await page.evaluate(() => {
    // build tag lives on custom element tag names and the toolbar badge
    const el = document.querySelector('[class*="toolbar-build-tag"], .texto-toolbar');
    const tags = [...document.querySelectorAll('*')].map((n) => n.tagName).find((t) => /-[\w]+-0\.\d+\.\d+/.test(t));
    return { badge: el?.textContent?.slice(0, 40) ?? null, customTag: tags ?? null };
  });
}

if (stage === 'select') {
  R.select = await page.evaluate(() => {
    const ed = window.__ed;
    if (!ed) return { err: 'no editor handle' };
    const handles = [...document.querySelectorAll('.texto-table__resize-handle')];
    return {
      handleCount: handles.length,
      handles: handles.map((h) => {
        const r = h.getBoundingClientRect();
        return {
          cellPos: h.dataset.cellPos ?? null,
          ignoreSwipe: h.dataset.ignoreSwipe ?? null,
          rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
          screen: { w: window.innerWidth, h: window.innerHeight },
        };
      }),
      colwidthBefore: (() => {
        let cw = null;
        ed.state.doc.descendants((n) => {
          if (n.type.name === 'table' && cw == null) {
            const first = n.content.firstChild;
            cw = first?.content?.content?.map((c) => c.attrs.colwidth) ?? null;
            return false;
          }
          return true;
        });
        return cw;
      })(),
      drawerLeftWidth: document.querySelector('.workspace-drawer.mod-left')?.getBoundingClientRect().width ?? null,
    };
  });
}

if (stage === 'check') {
  R.check = await page.evaluate(() => {
    const ed = window.__ed;
    const drawer = (side) => document.querySelector(`.workspace-drawer.mod-${side}`)?.getBoundingClientRect().width ?? null;
    return {
      colwidthAfter: (() => {
        let cw = null;
        ed?.state.doc.descendants((n) => {
          if (n.type.name === 'table' && cw == null) {
            const first = n.content.firstChild;
            cw = first?.content?.content?.map((c) => c.attrs.colwidth) ?? null;
            return false;
          }
          return true;
        });
        return cw;
      })(),
      drawerLeft: drawer('left'),
      drawerRight: drawer('right'),
      bodyClass: document.body.className,
      docChangedSinceOpen: ed ? ed.state.doc !== ed.state.doc : null,
    };
  });
  R.screenshot = `local/../scripts/debug/resize-swipe-${stage}-${Date.now()}.png`;
  const shotPath = `scripts/debug/resize-swipe-${Date.now()}.png`;
  await page.screenshot({ path: shotPath });
  R.screenshot = shotPath;
}

writeFileSync('scripts/debug/verify-resize-swipe-last.json', JSON.stringify(R, null, 2));
console.log(JSON.stringify(R, null, 1));
await browser.close().catch(() => {});
