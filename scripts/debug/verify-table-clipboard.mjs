// tmp-verify-desktop.mjs — desktop verification of the table clipboard task
// (issue table-clipboard) in the live obsidian-plugin dev vault, CDP :9223.
// Trusted keyboard/mouse via playwright Input; state reads via evaluate.
import { chromium } from 'playwright-core';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9223', { timeout: 8000 });

const R = {};
let page = null;
try {
  // 0. find the dev-vault window (rule-verify-both-platforms: only the
  //    obsidian-plugin vault may be touched)
  const appPages = browser.contexts().flatMap((c) => c.pages()).filter((x) => x.url().startsWith('app://obsidian.md'));
  for (const p of appPages) {
    const vault = await p.evaluate(() => window.app?.vault?.getName?.() ?? null);
    if (vault === 'obsidian-plugin') {
      page = p;
      break;
    }
  }
  R.windows = await Promise.all(appPages.map((p) => p.evaluate(() => window.app?.vault?.getName?.() ?? null)));
  if (page == null) throw new Error('obsidian-plugin vault window not found');

  // The window must be OS-focused: trusted copy/cut keyboard commands are
  // dropped by Chromium when the web contents have no focus.
  R.windowFocus = await page.evaluate(() => {
    const win = window.electron?.remote?.getCurrentWindow?.();
    if (!win) return 'no electron.remote';
    win.show();
    win.focus();
    return win.getTitle();
  });
  await page.waitForTimeout(400);

  // 1. the app was reloaded (app:reload) AFTER the build, so the fresh
  //    bundle is already live; just confirm the plugin is enabled
  R.pluginEnabled = await page.evaluate(() => !!app.plugins.getPlugin('inscriptum'));

  // 2. write the test note (two 3-col tables: header + 2 body rows each).
  //    Unique name per run: a restored workspace tab may hold a stale doc
  //    for a reused path (the view does not necessarily reload from disk).
  const notePath = `local/table-clipboard-verify-${Date.now()}.note`;
  R.notePath = notePath;
  await page.evaluate(async (notePath) => {
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
    await app.vault.adapter.write(notePath, JSON.stringify(doc));
    const file = app.vault.getAbstractFileByPath(notePath);
    // close the tabs my earlier runs left behind, keep exactly one leaf
    const existing = app.workspace.getLeavesOfType('note-view')
      .filter((l) => (l.view?.file?.path ?? '').startsWith('local/table-clipboard-verify'));
    const leaf = app.workspace.getLeaf('tab');
    await leaf.openFile(file);
    for (const l of existing) {
      if (l !== leaf) {
        try { l.detach(); } catch {}
      }
    }
    app.workspace.revealLeaf(leaf);
    window.__ed = leaf.view.editor ?? null;
  }, notePath);
  await page.waitForTimeout(1200);
  R.editorUp = await page.evaluate(() => !!window.__ed);

  // helpers evaluated in-page (re-resolve the editor: it is created
  // asynchronously after the leaf mounts)
  await page.evaluate((notePath) => {
    const leaf = app.workspace.getLeavesOfType('note-view').find((l) => l.view?.file?.path === notePath);
    window.__ed = leaf.view.editor;
    window.__cellPos = (text) => {
      let p = null;
      window.__ed.state.doc.descendants((node, pos) => {
        if (!p && (node.type.name === 'tableCell' || node.type.name === 'tableHeader') && node.textContent === text) p = pos;
        return !p;
      });
      return p;
    };
    window.__tableTexts = (idx) => {
      const out = [];
      let seen = -1;
      window.__ed.state.doc.descendants((node) => {
        if (node.type.name === 'table') { seen += 1; return seen === idx; }
        if (seen === idx && (node.type.name === 'tableCell' || node.type.name === 'tableHeader')) out.push(node.textContent);
        return true;
      });
      return out;
    };
    window.__selRect = (a, b) => {
      window.__ed.commands.setCellSelection({ anchorCell: window.__cellPos(a), headCell: window.__cellPos(b) });
      window.__ed.view.focus();
    };
    window.__caret = (text) => {
      const pos = window.__cellPos(text);
      window.__ed.commands.focus(pos + 1);
      window.__ed.view.focus();
    };
  }, notePath);

  // focus the web contents with a trusted click into the editor, then keep
  // PM focus via the API (native copy/cut need OS-focused web contents)
  const edRect = await page.evaluate(() => {
    const r = window.__ed.view.dom.getBoundingClientRect();
    return { x: r.x + Math.min(80, r.width / 2), y: r.y + 8 };
  });
  if (edRect.width === 0) throw new Error('editor has no layout');
  await page.mouse.click(edRect.x, edRect.y);
  await page.waitForTimeout(200);
  R.focusAfterClick = await page.evaluate(() => window.__ed.view.hasFocus());

  // 3. rect copy from A00..A11 -> rect paste onto B00..B11
  await page.evaluate(() => window.__selRect('A00', 'A11'));
  await page.keyboard.press('Meta+c');
  await page.waitForTimeout(150);
  await page.evaluate(() => window.__selRect('B00', 'B11'));
  await page.keyboard.press('Meta+v');
  await page.waitForTimeout(250);
  R.rectPaste = await page.evaluate(() => window.__tableTexts(1));

  // 4. undo once — the paste must roll back in a single step
  await page.keyboard.press('Meta+z');
  await page.waitForTimeout(200);
  R.afterUndo = await page.evaluate(() => window.__tableTexts(1));

  // 5. rows copy (full rows A0+A1) -> caret in B00 -> paste inserts rows
  await page.evaluate(() => window.__selRect('A00', 'A12'));
  await page.keyboard.press('Meta+c');
  await page.waitForTimeout(150);
  await page.evaluate(() => window.__caret('B00'));
  R.caretType = await page.evaluate(() => window.__ed.state.selection.constructor.name);
  await page.keyboard.press('Meta+v');
  await page.waitForTimeout(250);
  R.rowsAtCaret = await page.evaluate(() => window.__tableTexts(1));
  await page.keyboard.press('Meta+z');
  await page.waitForTimeout(200);

  // 6. Cmd+X on a full body row removes the row
  await page.evaluate(() => window.__selRect('A00', 'A02'));
  await page.keyboard.press('Meta+x');
  await page.waitForTimeout(250);
  R.cutRow = await page.evaluate(() => window.__tableTexts(0));
  await page.keyboard.press('Meta+z');
  await page.waitForTimeout(200);

  // 7. Cmd+X on a partial rect clears contents
  await page.evaluate(() => window.__selRect('A00', 'A11'));
  await page.keyboard.press('Meta+x');
  await page.waitForTimeout(250);
  R.cutPartial = await page.evaluate(() => window.__tableTexts(0));
  await page.keyboard.press('Meta+z');
  await page.waitForTimeout(200);

  // 8. focus after a real circle drag (trusted mouse): caret in A11 -> drag
  //    the selection circle to B11... wait, drag stays in one table: to B02.
  await page.evaluate(() => window.__caret('A11'));
  await page.waitForTimeout(300);
  const circle = await page.evaluate(() => {
    const el = window.__ed.view.dom.querySelector('.texto-table__overlay_overlay-circle');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, cellPos: el.dataset.cellPos };
  });
  R.circle = circle;
  if (circle) {
    const target = await page.evaluate(() => {
      const td = [...window.__ed.view.dom.querySelectorAll('td,th')].find((el) => el.textContent === 'A02');
      const r = td.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    });
    await page.mouse.move(circle.x, circle.y);
    await page.mouse.down();
    await page.mouse.move(target.x, target.y, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    R.afterDrag = await page.evaluate(() => {
      const s = window.__ed.state.selection;
      return {
        type: s.constructor.name,
        anchorCell: s.$anchorCell ? s.$anchorCell.pos : null,
        headCell: s.$headCell ? s.$headCell.pos : null,
        hasFocus: window.__ed.view.hasFocus(),
      };
    });
    // 9. trusted Cmd+C right after the drag — the focus fix makes it work
    await page.keyboard.press('Meta+c');
    await page.waitForTimeout(150);
    await page.evaluate(() => window.__selRect('B00', 'B12'));
    await page.keyboard.press('Meta+v');
    await page.waitForTimeout(250);
    R.pasteAfterDragCopy = await page.evaluate(() => window.__tableTexts(1));
  }
  // cleanup: close the leaf (file not open anymore), then delete this run's
  // note and any leftovers of earlier runs (explicit user-style deletes —
  // never while the file is open in a view, see rule-open-file-safety)
  await page.evaluate(async (notePath) => {
    const files = app.vault.getFiles().filter((f) => f.path.startsWith('local/table-clipboard-verify'));
    for (const f of files) {
      const leaves = app.workspace.getLeavesOfType('note-view').filter((l) => l.view?.file?.path === f.path);
      for (const l of leaves) {
        try { l.detach(); } catch {}
      }
      await new Promise((r) => setTimeout(r, 150));
      try { await app.vault.delete(f); } catch {}
    }
  }, notePath);
  R.cleanedUp = true;
} finally {
  await browser.close().catch(() => {});
}
console.log(JSON.stringify(R, null, 2));
