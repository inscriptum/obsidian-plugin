import { chromium } from 'playwright-core';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9224', { timeout: 10000 });
const page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith('http://localhost/'));
if (page == null) throw new Error('Android Obsidian page not found');
const R = await page.evaluate(async () => {
  const cell = (t, extra = {}) => ({ type: 'tableCell', ...extra, content: [{ type: 'paragraph', content: t ? [{ type: 'text', text: t }] : [] }] });
  const row = (cells) => ({ type: 'tableRow', content: cells });
  const mk = (name) => ({
    type: 'table', attrs: { data: { rowsCount: 3, colsCount: 2 } },
    content: [
      row([cell(name + 'h0'), cell(name + 'h1')]),
      row([cell(name + '0'), cell('')]),
      row([cell(name + '1'), cell(name + '1e')]),
    ],
  });
  const notePath = `local/p1-verify-${Date.now()}.note`;
  await app.vault.adapter.write(notePath, JSON.stringify({
    type: 'noteDoc',
    content: [
      { type: 'noteTitle', content: [{ type: 'text', text: 'p1-verify' }] },
      mk('A'),
      { type: 'paragraph', content: [{ type: 'text', text: 'between' }] },
      mk('B'),
    ],
  }));
  const file = app.vault.getAbstractFileByPath(notePath);
  const leaf = app.workspace.getLeaf('tab');
  await leaf.openFile(file);
  await new Promise((r) => setTimeout(r, 900));
  const ed = leaf.view?.editor;
  const cellPos = (text) => {
    let p = null;
    ed.state.doc.descendants((node, pos) => {
      if (!p && (node.type.name === 'tableCell' || node.type.name === 'tableHeader') && node.textContent === text) p = pos;
      return !p;
    });
    return p;
  };
  const tableTexts = (idx) => {
    const out = [];
    let seen = -1;
    ed.state.doc.descendants((node) => {
      if (node.type.name === 'table') { seen += 1; return seen === idx; }
      if (seen === idx && (node.type.name === 'tableCell' || node.type.name === 'tableHeader')) out.push(node.textContent);
      return true;
    });
    return out;
  };
  const btn = (icon) => [...document.querySelectorAll('.table-bubble-menu-bar-host button')]
    .find((b) => b.querySelector('svg use')?.getAttribute('href') === `#inscriptum-bb-${icon}` && b.getBoundingClientRect().width > 0);
  // P1 scenario: copy column 1 rows [Ah1, EMPTY] of table A (empty located
  // INSIDE table A — bounded lookup, text collisions otherwise)
  let tableAEnd = 0;
  let seenA = false;
  ed.state.doc.descendants((node, pos) => {
    if (node.type.name === 'table') { if (seenA) return false; seenA = true; tableAEnd = pos + node.nodeSize; }
    return seenA && pos <= tableAEnd;
  });
  const emptyInA = (() => {
    let p = null;
    ed.state.doc.descendants((node, pos) => {
      if (!p && pos < tableAEnd && (node.type.name === 'tableCell' || node.type.name === 'tableHeader') && node.textContent === '') p = pos;
      return !p;
    });
    return p;
  })();
  ed.commands.setCellSelection({ anchorCell: cellPos('Ah1'), headCell: emptyInA });
  await new Promise((r) => setTimeout(r, 500));
  btn('copy').click();
  await new Promise((r) => setTimeout(r, 700));
  const clip = await navigator.clipboard.readText();
  // target: 2 cells of column 1 in table B (Bh1 + table B's own empty cell)
  const a = cellPos('Bh1');
  const b = (() => {
    let p = null;
    ed.state.doc.descendants((node, pos) => {
      if (!p && node.type.name === 'table' && pos > tableAEnd) {
        node.descendants((n, off) => {
          if (!p && (n.type.name === 'tableCell' || n.type.name === 'tableHeader') && n.textContent === '') p = pos + off + 1;
        });
        return false;
      }
      return !p;
    });
    return p;
  })();
  ed.commands.setCellSelection({ anchorCell: a, headCell: b });
  await new Promise((r) => setTimeout(r, 500));
  btn('paste').click();
  await new Promise((r) => setTimeout(r, 900));
  const bAfter = tableTexts(1);
  // cleanup
  const leaves = [];
  app.workspace.iterateAllLeaves((l) => leaves.push(l));
  const lv = leaves.find((l) => l.view?.file?.path === notePath);
  if (lv) { try { lv.detach(); } catch {} await new Promise((r) => setTimeout(r, 300)); }
  const f = app.vault.getAbstractFileByPath(notePath);
  if (f) { try { await app.vault.delete(f); } catch {} }
  return { clip: JSON.stringify(clip), tableBAfter: bAfter };
});
console.log(JSON.stringify(R, null, 1));
await browser.close().catch(() => {});
