// verify-wikilinks-round7.mjs — live desktop verification of the wikilinks
// round-7 model (committed marks, owner direction) in the dev vault, CDP
// :9223. Real keyboard via Playwright Input; screenshots per scenario.
import { chromium } from 'playwright-core';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';

const SHOTS = 'local/wikilinks-round7';
mkdirSync(SHOTS, { recursive: true });

// rule-verify-vault: only the vault whose ROOT is the plugin repo may be
// touched; verify by basePath, never by the vault NAME (several vaults may
// share a name, and unfiltered probes have landed in ~/insum).
const DEV_VAULT_ROOT = '/Users/d.sumbaev/DEVELOPMENT/inscriptum/obsidian-plugin';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9223', { timeout: 8000 });
const R = {};
let page = null;
try {
  for (const p of browser.contexts().flatMap((c) => c.pages()).filter((x) => x.url().startsWith('app://obsidian.md'))) {
    const base = await p.evaluate(() => window.app?.vault?.adapter?.basePath ?? null);
    if (base === DEV_VAULT_ROOT) { page = p; break; }
  }
  if (page == null) throw new Error(`dev vault window not found (${DEV_VAULT_ROOT})`);
  await page.evaluate(() => {
    const win = window.electron?.remote?.getCurrentWindow?.();
    win?.show?.(); win?.focus?.();
  });
  await page.waitForTimeout(400);
  R.pluginEnabled = await page.evaluate(() => !!app.plugins.getPlugin('inscriptum'));

  // A scratch note + a target note for resolved links.
  const stamp = Date.now();
  const notePath = `wl7-verify-${stamp}.note`;
  const targetPath = `wl7-target-${stamp}.note`;
  // the app names .note files by their note TITLE (UM convention), so the
  // titles must be stable and filesystem-friendly
  const mkNote = (title) => JSON.stringify({
    type: 'noteDoc',
    content: [
      { type: 'noteTitle', content: [{ type: 'text', text: title }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'target body' }] },
    ],
  });
  R.written = await page.evaluate(async ({ notePath, targetPath, mkSrc }) => {
    const mkNote = new Function('title', 'return (' + mkSrc + ')(title);');
    await app.vault.create(notePath, mkNote('wl7 verify'));
    await app.vault.create(targetPath, mkNote('wl7 target'));
    return true;
  }, { notePath, targetPath, mkSrc: mkNote.toString() });
  await page.waitForTimeout(600);
  R.filesIndexed = await page.evaluate((t) => !!app.vault.getAbstractFileByPath(t), targetPath);

  const open = async (path) => {
    await page.evaluate(async (path) => {
      // edited notes get re-pointed to '<title>.note' by the app (UM naming)
      const file = app.vault.getAbstractFileByPath('wl7 verify.note')
        ?? app.vault.getAbstractFileByPath(path);
      if (file == null) throw new Error('file not indexed: ' + path);
      const leaf = app.workspace.getLeaf('tab');
      await leaf.openFile(file);
      app.workspace.revealLeaf(leaf);
    }, path);
    await page.waitForTimeout(1000);
  };
  const ed = async () => {
    for (let i = 0; i < 20; i += 1) {
      const ok = await page.evaluate(() => {
        const leaf = app.workspace.getLeavesOfType('note-view').find((l) => l.view?.file?.path === 'wl7 verify.note' || l.view?.file?.path?.startsWith('wl7-verify-'));
        const editor = leaf?.view?.editor ?? null;
        if (editor) window.__ed = editor;
        return !!editor;
      });
      if (ok) return true;
      await page.waitForTimeout(250);
    }
    return false;
  };
  const shot = async (name) => page.screenshot({ path: `${SHOTS}/${name}.png` });
  const docState = () => page.evaluate(() => {
    const e = window.__ed;
    const s = e.state.selection;
    return {
      text: e.state.doc.textBetween(0, e.state.doc.content.size),
      json: JSON.stringify(e.state.doc.toJSON().content?.[1] ?? {}),
      caret: s.from,
      empty: s.empty,
    };
  });

  // ── open the scratch note and click into its paragraph ──
  await open(notePath);
  if (!(await ed())) throw new Error('editor not mounted');
  const edRect = await page.evaluate(() => {
    const r = window.__ed.view.dom.querySelector('p')?.getBoundingClientRect();
    return r ? { x: r.x + 10, y: r.y + r.height / 2 } : null;
  });
  await page.mouse.click(edRect.x, edRect.y);
  await page.waitForTimeout(300);
  await page.keyboard.press('End');
  await page.waitForTimeout(150);

  // 1. «[[» → auto-close + popup
  await page.keyboard.type(' see [[');
  await page.waitForTimeout(350);
  R.s1_popup = await page.evaluate(() => ({
    popup: !!document.querySelector('.texto-wiki-suggest'),
    names: Array.from(document.querySelectorAll('.texto-wiki-suggest__name')).slice(0, 4).map((n) => n.textContent),
  }));
  R.s1_doc = await docState();
  await shot('01-trigger-popup');

  // 2. query filters, Enter accepts → committed mark
  await page.keyboard.type('wiki-tar');
  await page.waitForTimeout(350);
  await shot('02-filtered');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(350);
  R.s2_committed = await docState();
  R.s2_span = await page.evaluate(() => {
    const span = window.__ed.view.dom.querySelector('span.texto-wikilink');
    return span ? { text: span.textContent, path: span.getAttribute('data-wiki-path') } : null;
  });
  await shot('03-committed-after-enter');

  // 3. label via |
  await page.keyboard.type(' and [[');
  await page.waitForTimeout(300);
  await page.keyboard.type('wiki-tar');
  await page.waitForTimeout(300);
  await page.keyboard.type('|My Label');
  await page.waitForTimeout(350);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(350);
  R.s3 = await docState();
  await shot('04-label-committed');

  // 4. space inside the target stays put
  await page.keyboard.type(' x [[');
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  await page.keyboard.type('spa');
  await page.waitForTimeout(150);
  await page.keyboard.press('Space');
  await page.waitForTimeout(200);
  R.s4_space = await docState();
  await shot('05-space-inside-target');

  // 5. caret exit commits
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(120);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);
  R.s5_exit = await docState();
  await shot('06-exit-committed');

  // 6. plain click on a committed label: caret in label, view unchanged
  const labelBox = await page.evaluate(() => {
    const spans = window.__ed.view.dom.querySelectorAll('span.texto-wikilink');
    const span = spans[spans.length - 1];
    const r = span.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.click(labelBox.x, labelBox.y);
  await page.waitForTimeout(300);
  R.s6_click = await docState();
  await shot('07-click-caret-in-label');

  // 7. hover → bubble menu (pointer must genuinely re-enter the span:
  // move away first, then onto it — a stationary pointer fires no mouseover)
  await page.mouse.move(8, 8);
  await page.waitForTimeout(150);
  await page.mouse.move(labelBox.x, labelBox.y);
  await page.waitForTimeout(400);
  R.s7_menu = await page.evaluate(() => {
    const menu = document.querySelector('.texto-wiki-hover');
    return menu ? { path: menu.querySelector('.texto-wiki-hover__path')?.textContent, buttons: Array.from(menu.querySelectorAll('[aria-label]')).map((b) => b.getAttribute('aria-label')) } : null;
  });
  await shot('08-hover-bubble-menu');

  // 8. Edit from the menu → suggest reopens on the raw syntax
  await page.evaluate(() => {
    const menu = document.querySelector('.texto-wiki-hover');
    menu?.querySelector('[aria-label="Edit wikilink"]')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  });
  await page.waitForTimeout(400);
  R.s8_edit = await docState();
  R.s8_popup = await page.evaluate(() => !!document.querySelector('.texto-wiki-suggest'));
  await shot('09-edit-reopens-suggest');

  // 9. Enter re-commits (keeps the label)
  await page.keyboard.press('Enter');
  await page.waitForTimeout(350);
  R.s9_recommit = await docState();

  // 10. hover → «Перейти» opens the target
  const resolvedBox = await page.evaluate(() => {
    const span = Array.from(window.__ed.view.dom.querySelectorAll('span.texto-wikilink'))
      .find((s) => s.getAttribute('data-wiki-path')?.includes('wiki-target'));
    const r = span.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.move(resolvedBox.x, resolvedBox.y);
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const menu = document.querySelector('.texto-wiki-hover');
    menu?.querySelector('[aria-label="Open wikilink target"]')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  });
  await page.waitForTimeout(900);
  R.s10_opened = await page.evaluate(() => app.workspace.getActiveViewOfType?.(window.require?.('obsidian')?.View)?.file?.path ?? null)
    .catch(() => null);
  R.s10_activeLeaf = await page.evaluate(() => app.workspace.activeLeaf?.view?.file?.path ?? null);
  await shot('10-opened-target');

  // back to the scratch note for the rest
  await open(notePath);
  await ed();
  await page.waitForTimeout(300);

  // 11. Mod-click follows the link
  const anyLink = await page.evaluate(() => {
    const span = window.__ed.view.dom.querySelector('span.texto-wikilink');
    const r = span.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.click(anyLink.x, anyLink.y, { modifiers: ['Meta'] });
  await page.waitForTimeout(900);
  R.s11_modclick = await page.evaluate(() => app.workspace.activeLeaf?.view?.file?.path ?? null);
  await open(notePath);
  await ed();

  // 12. backspace edits the label char by char, syntax never breaks
  const lab = await page.evaluate(() => {
    const span = window.__ed.view.dom.querySelector('span.texto-wikilink');
    const r = span.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.click(lab.x, lab.y);
  await page.waitForTimeout(200);
  await page.keyboard.press('End');
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(200);
  R.s12_backspace = await docState();
  await shot('11-backspace-label');

  // 13. selection over the label: no formatting bubble
  await page.evaluate(() => {
    const e = window.__ed;
    const pos = (() => {
      let p = null;
      e.state.doc.descendants((node, at) => {
        if (!p && node.isText && node.marks.some((m) => m.type.name === 'wikiLink')) p = { from: at, to: at + node.nodeSize };
        return !p;
      });
      return p;
    })();
    e.commands.setTextSelection({ from: pos.from + 1, to: pos.to - 1 });
    e.view.focus();
  });
  await page.waitForTimeout(500);
  R.s13_bubble = await page.evaluate(() => ({
    bubbleVisible: !!document.querySelector('.bubble-menu-bar')?.offsetParent,
    anyTippyShown: Array.from(document.querySelectorAll('.tippy-box')).some((t) => t.offsetParent !== null || getComputedStyle(t).visibility !== 'hidden'),
  }));
  await shot('12-no-formatting-bubble');

  // 14. unresolved link: muted, Перейти inert, Edit works
  // (caret via PM commands — a stray click can land in the note title)
  await page.evaluate(() => {
    const e = window.__ed;
    e.commands.setTextSelection(e.state.doc.content.size - 1);
    e.view.focus();
  });
  await page.waitForTimeout(250);
  await page.keyboard.type(' ghost [[');
  await page.waitForTimeout(300);
  await page.keyboard.press('Escape');
  await page.keyboard.type('nowhere/gone.md');
  await page.waitForTimeout(200);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(120);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);
  R.s14 = await docState();
  await shot('13-unresolved-muted');

  // 15. persistence: reload the note from disk, the link must survive
  R.s15_leafList = await page.evaluate(() => app.workspace.getLeavesOfType('note-view').map((l) => l.view?.file?.path ?? null));
  const closed = await page.evaluate(async (notePath) => {
    const leaf = app.workspace.getLeavesOfType('note-view').find((l) => l.view?.file?.path === notePath);
    if (leaf == null) return false;
    await leaf.view.onClose?.();
    leaf.detach();
    return true;
  }, notePath);
  R.s15_closed = closed;
  await page.waitForTimeout(400);
  await open(notePath);
  await ed();
  await page.waitForTimeout(300);
  R.s15_reload = await docState();
  // the app's autosave may store the edited copy under a derived name —
  // read whichever file the vault actually indexes
  R.s15_onDisk = readdirSync('.').filter((f) => f.startsWith('wl7-verify-') || f === 'wl7 verify.note').map((f) => {
    try {
      return readFileSync(f, 'utf8').includes('wikiLink') ? f + ':mark' : f + ':plain';
    } catch { return f + ':unreadable'; }
  });
  await shot('14-after-reload');

  // 16. legacy raw-pattern migration on read
  const legacyPath = `wl7-legacy-${stamp}.note`;
  // a complete raw pattern from the rounds-3…6 era, written straight to disk
  await page.evaluate(async ({ legacyPath }) => {
    const doc = {
      type: 'noteDoc',
      content: [
        { type: 'noteTitle', content: [{ type: 'text', text: 'wiki legacy' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'old [[some/old-target.md|old label]] text' }] },
      ],
    };
    await app.vault.create(legacyPath, JSON.stringify(doc));
  }, { legacyPath });
  await page.waitForTimeout(600);
  await open(legacyPath);
  await page.evaluate(() => {
    const leaf = app.workspace.getLeavesOfType('note-view').find((l) => l.view?.file?.path?.startsWith('wl7-legacy-'));
    window.__ed = leaf?.view?.editor ?? null;
  });
  await page.waitForTimeout(300);
  R.s16_legacy = await page.evaluate(() => {
    const e = window.__ed;
    const span = e?.view.dom.querySelector('span.texto-wikilink');
    return { span: span ? { text: span.textContent, path: span.getAttribute('data-wiki-path') } : null };
  });
  await shot('15-legacy-migrated');

  console.log(JSON.stringify(R, null, 2));
} catch (err) {
  console.log('PARTIAL:', JSON.stringify(R, null, 2));
  throw err;
} finally {
  await browser.close().catch(() => {});
}
