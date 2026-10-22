// tmp-verify-android.mjs — mobile verification of the table clipboard task
// on the Android emulator (CDP :9224), obsidian-plugin vault only.
import { chromium } from 'playwright-core';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9224', { timeout: 10000 });
const page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith('http://localhost/'));
if (page == null) throw new Error('Android Obsidian page not found');

const R = {};
R.vault = await page.evaluate(() => window.app?.vault?.getName?.() ?? null);
R.plugin = await page.evaluate(() => !!window.app?.plugins?.getPlugin?.('inscriptum'));

// write the test note (two 3-col tables) and open it
R.setup = await page.evaluate(async () => {
  const mk = (name) => ({
    type: 'table', attrs: { data: { rowsCount: 3, colsCount: 3 } },
    content: [
      { type: 'tableRow', content: [0, 1, 2].map((i) => ({ type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: name + 'h' + i }] }] })) },
      { type: 'tableRow', content: [0, 1, 2].map((i) => ({ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: name + '0' + i }] }] })) },
      { type: 'tableRow', content: [0, 1, 2].map((i) => ({ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: name + '1' + i }] }] })) },
    ],
  });
  const doc = {
    type: 'noteDoc',
    content: [
      { type: 'noteTitle', content: [{ type: 'text', text: 'table-clipboard-verify' }] },
      mk('A'),
      { type: 'paragraph', content: [{ type: 'text', text: 'between' }] },
      mk('B'),
    ],
  };
  await app.vault.adapter.write('local/table-clipboard-verify.note', JSON.stringify(doc));
  const file = app.vault.getAbstractFileByPath('local/table-clipboard-verify.note');
  const leaf = app.workspace.getLeaf('tab');
  await leaf.openFile(file);
  app.workspace.revealLeaf(leaf);
  await new Promise((r) => setTimeout(r, 800));
  const ed = leaf.view?.editor;
  if (!ed) return { err: 'no editor' };
  window.__ed = ed;
  window.__cellPos = (text) => {
    let p = null;
    ed.state.doc.descendants((node, pos) => {
      if (!p && (node.type.name === 'tableCell' || node.type.name === 'tableHeader') && node.textContent === text) p = pos;
      return !p;
    });
    return p;
  };
  window.__tableTexts = (idx) => {
    const out = [];
    let seen = -1;
    ed.state.doc.descendants((node) => {
      if (node.type.name === 'table') { seen += 1; return seen === idx; }
      if (seen === idx && (node.type.name === 'tableCell' || node.type.name === 'tableHeader')) out.push(node.textContent);
      return true;
    });
    return out;
  };
  return { ok: true, platform: { isMobile: /is-mobile/.test(document.body.className) || Boolean(window.Capacitor), ua: navigator.userAgent.slice(0, 60) } };
});

// rect paste: CellSelection over B00..B11 + synthetic paste with a copied 2x2
R.rectPaste = await page.evaluate(() => {
  const ed = window.__ed;
  ed.commands.setCellSelection({ anchorCell: window.__cellPos('B00'), headCell: window.__cellPos('B11') });
  const html = '<table data-pm-slice="1 1 -2 []"><tbody><tr><td colspan="1" rowspan="1" data-colwidth="50"><p>A00</p></td><td colspan="1" rowspan="1" data-colwidth="50"><p>A01</p></td></tr><tr><td colspan="1" rowspan="1" data-colwidth="50"><p>A10</p></td><td colspan="1" rowspan="1" data-colwidth="50"><p>A11</p></td></tr></tbody></table>';
  const dt = new DataTransfer();
  dt.setData('text/html', html);
  dt.setData('text/plain', 'A00\n\nA01\n\nA10\n\nA11');
  ed.view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  return window.__tableTexts(1);
});

// undo
R.afterUndo = await page.evaluate(() => {
  window.__ed.commands.undo();
  return window.__tableTexts(1);
});

// rows insert at caret
R.rowsAtCaret = await page.evaluate(() => {
  const ed = window.__ed;
  const pos = window.__cellPos('B00');
  ed.commands.focus(pos + 1);
  const html = '<table data-pm-slice="1 1 -2 []"><tbody><tr><td colspan="1" rowspan="1" data-colwidth="50"><p>A00</p></td><td colspan="1" rowspan="1" data-colwidth="50"><p>A01</p></td></tr><tr><td colspan="1" rowspan="1" data-colwidth="50"><p>A10</p></td><td colspan="1" rowspan="1" data-colwidth="50"><p>A11</p></td></tr></tbody></table>';
  const dt = new DataTransfer();
  dt.setData('text/html', html);
  ed.view.dom.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  return window.__tableTexts(1);
});

await browser.close().catch(() => {});
console.log(JSON.stringify(R, null, 2));
