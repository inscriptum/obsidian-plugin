// verify-color-picker-mobile.mjs — mobile verification of the custom color
// picker fix (task mobile-color-picker-closes) on the Android emulator.
//
// Usage: node scripts/debug/verify-color-picker-mobile.mjs
// Requires: npm run android:debug deployed (the build under test) and the
// adb forward for CDP :9224 alive (re-established here when needed).
//
// Real CDP touches drive the user flow (synthetic clicks bypass the touch
// path the bug lives in; every touch is preceded by an elementFromPoint
// self-check so a stale coordinate cannot silently tap the wrong thing).
// Checks in the text Styles layer, table Cell-fill layer and table Borders
// pen dropdown:
//   1. coarse-pointer branch renders .bb-dd-open, no native input[type=color]
//   2. tapping .bb-dd-open opens the popup; the toolbar host and the soft
//      keyboard survive the whole interaction (the original bug: the host
//      died with the keyboard and killed the picker)
//   3. a popup swatch applies the color and closes the popup
//   4. the hex field keeps the bar open and Enter applies the value
// The cells bubble (4th custom row instance) is desktop-only in NoteView —
// verified on desktop, not here.
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';

const endpoint = process.env.ANDROID_CDP ?? 'http://127.0.0.1:9224';

try {
  const pid = execFileSync('adb', ['-s', 'emulator-5554', 'shell', 'pidof', 'md.obsidian'], { encoding: 'utf8' }).trim();
  execFileSync('adb', ['-s', 'emulator-5554', 'forward', 'tcp:9224', `localabstract:webview_devtools_remote_${pid}`]);
} catch (e) {
  console.error('adb forward failed: ' + String(e).slice(0, 120));
}

const browser = await chromium.connectOverCDP(endpoint, { timeout: 10000 });
const page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith('http://localhost/'));
if (!page) { console.error('Obsidian mobile page not found — run npm run android:debug first'); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// real tap at CSS coordinates through CDP
async function touch(x, y) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
  await sleep(90);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach().catch(() => {});
}

// measure a rect center + verify the element actually sits there
async function target(selScopeJs, name) {
  const t = await page.evaluate(`(() => {
    const el = ${selScopeJs};
    if (!el) return { error: 'no element for ${name}' };
    const r = el.getBoundingClientRect();
    const c = { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    const hit = document.elementFromPoint(c.x, c.y);
    return { ...c, hitOk: !!hit && (hit === el || el.contains(hit) || hit.contains(el)), hitWhat: hit ? hit.tagName + '.' + (hit.className || '').toString().slice(0, 24) : 'none' };
  })()`, undefined, { timeout: 15000 });
  if (t.error) throw new Error(`${name}: ${t.error}`);
  if (!t.hitOk) throw new Error(`${name}: elementFromPoint mismatch at (${t.x},${t.y}) — ${t.hitWhat}`);
  return t;
}

const R = {};
const step = (name, v) => { R[name] = v; console.log(name + ': ' + JSON.stringify(v)); };

// find a tappable point inside an element: sample candidates across its rect
// (and scroll the editor scroller when the element is off-viewport or covered
// by a fixed overlay — the keyboard shifts the layout), verify each candidate
// with elementFromPoint. All inside one eval to avoid CDP round-trips.
async function targetWithRetry(selJs, name) {
  const t = await page.evaluate(`(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let el = null;
    for (let a = 0; a < 8; a++) {
      el = ${selJs};
      if (!el) return { error: 'no element' };
      const r = el.getBoundingClientRect();
      const pts = [];
      for (const fy of [0.5, 0.35, 0.65, 0.2, 0.8]) {
        for (const fx of [0.5, 0.3, 0.7]) pts.push([r.left + r.width * fx, r.top + r.height * fy]);
      }
      for (const [x, y] of pts) {
        if (x < 2 || y < 2 || x > innerWidth - 2 || y > innerHeight - 2) continue;
        const hit = document.elementFromPoint(Math.round(x), Math.round(y));
        if (hit && (hit === el || el.contains(hit) || hit.contains(el))) {
          return { x: Math.round(x), y: Math.round(y) };
        }
      }
      // not hittable: scroll the nearest scroller toward the element
      let p = el.parentElement;
      while (p && p.scrollHeight <= p.clientHeight + 2) p = p.parentElement;
      if (p) {
        const er = el.getBoundingClientRect();
        const dir = er.top < 40 ? -1 : er.bottom > innerHeight - 120 ? 1 : 0;
        p.scrollTop += dir * 90;
        await sleep(120);
      } else break;
    }
    return { error: 'no hittable point found for element' };
  })()`, undefined, { timeout: 30000 });
  if (t.error) throw new Error(`${name}: ${t.error}`);
  return t;
}

// ── setup: note with text + a 2×2 table ──
const setup = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const vault = app.vault;
  if (vault.getName() !== 'TestVault') return { error: 'wrong vault: ' + vault.getName() };
  const NOTE = 'local/color-picker-verify.note';
  let n = 0;
  const mk = () => 'vfy' + (n++).toString(36).padStart(7, '0');
  const para = (t) => ({ type: 'paragraph', attrs: { id: mk(), align: null }, content: [{ type: 'text', text: t }] });
  const cell = (t) => ({ type: 'tableCell', content: [para(t)] });
  const row = (a, b) => ({ type: 'tableRow', content: [cell(a), cell(b)] });
  const table = { type: 'table', attrs: { id: mk(), data: { rowsCount: 2, colsCount: 2 } }, content: [row('alpha', 'bravo'), row('charlie', 'delta')] };
  const doc = { type: 'noteDoc', content: [
    { type: 'noteTitle', attrs: { id: mk() }, content: [{ type: 'text', text: 'color-picker-verify' }] },
    para('Alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey.'),
    table,
  ] };
  const raw = JSON.stringify(doc, null, 2);
  const existing = vault.getAbstractFileByPath(NOTE);
  if (existing) await vault.modify(existing, raw); else await vault.create(NOTE, raw);
  const leaf = app.workspace.getLeaf('tab');
  // reopen: a fresh view state (no stale layers/scroll from previous runs)
  await leaf.openFile(vault.getAbstractFileByPath(NOTE));
  app.workspace.setActiveLeaf(leaf, { focus: true });
  await sleep(800);
  // deterministic reset: caret at doc start, editor blurred, keyboard closed
  const ed0 = app.workspace.activeLeaf.view.editor;
  ed0.commands.setTextSelection({ from: 1, to: 1 });
  ed0.commands.blur();
  await sleep(900); // keyboard hide settles
  const view = app.workspace.activeLeaf.view;
  const pm = view.contentEl.querySelector('.ProseMirror');
  const firstP = [...pm.children].find((el) => el.tagName === 'P');
  const pr = firstP.getBoundingClientRect();
  const td = pm.querySelector('td, th');
  const tr = td.getBoundingClientRect();
  return {
    ok: true, plugin: !!app.plugins.getPlugin('inscriptum'),
    coarse: matchMedia('(pointer: coarse)').matches,
    kbClosed: !app.workspace.activeLeaf.view.contentEl.classList.contains('is-keyboard-open'),
    textBarActive: app.workspace.activeLeaf.view.contentEl.querySelector('.mobile-sel-bar--text')?.classList.contains('is-active') ?? false,
    textTap: { x: Math.round(pr.left + 90), y: Math.round(pr.top + pr.height / 2) },
    cellTap: { x: Math.round(tr.left + tr.width / 2), y: Math.round(tr.top + tr.height / 2) },
  };
})()`;
const s = await page.evaluate(setup, undefined, { timeout: 30000 });
if (s.error) { console.log(JSON.stringify(s)); process.exit(1); }
console.log('setup:', JSON.stringify(s));
R.coarse = s.coarse; R.plugin = s.plugin;
if (!s.kbClosed || s.textBarActive) { console.log('DIRTY STATE — rerun (keyboard/bar not reset)'); process.exit(2); }

// select text + open the styles layer (buttons never steal focus)
const selectAndOpenStyles = `(() => new Promise((res) => setTimeout(() => {
  const view = app.workspace.activeLeaf.view;
  const ed = view.editor;
  ed.commands.setTextSelection({ from: 4, to: Math.min(60, ed.state.doc.content.size - 2) });
  setTimeout(() => {
    const btn = view.contentEl.querySelector('.mobile-sel-bar--text button[data-tip="Styles & color"]');
    if (!btn) { res({ error: 'no styles button' }); return; }
    btn.click();
    setTimeout(() => {
      const c = view.contentEl;
      const layer = c.querySelector('.bubble-menu-layer--styles');
      res({
        layerShown: layer?.classList.contains('show') ?? false,
        customBtn: !!c.querySelector('.mobile-sel-bar--text .bb-dd-open'),
        nativeInput: !!c.querySelector('.mobile-sel-bar--text .bb-dd-custom input[type=color]'),
        barVisible: c.querySelector('.mobile-sel-bar--text').offsetHeight > 0,
        kbOpen: c.classList.contains('is-keyboard-open'),
        focus: ed.view.hasFocus(),
      });
    }, 500);
  }, 350);
}, 0)))()`;

// ── TEXT: swatch flow ──
await touch(s.textTap.x, s.textTap.y);
await sleep(900); // keyboard opens like in the user flow
step('text.styles', await page.evaluate(selectAndOpenStyles, undefined, { timeout: 20000 }));
const openBtn = await target(`app.workspace.activeLeaf.view.contentEl.querySelector('.mobile-sel-bar--text .bb-dd-open')`, 'text .bb-dd-open');
await touch(openBtn.x, openBtn.y);
await sleep(400);
step('text.popupOpen', await page.evaluate(`(() => {
  const c = app.workspace.activeLeaf.view.contentEl;
  const popup = c.querySelector('.mobile-sel-bar--text .bb-dd-popup');
  const swatches = [...popup.querySelectorAll('.bb-sw')];
  const sw = swatches[25]; // a mid-grid swatch; the assert compares the applied color to this swatch's own background
  const r = sw.getBoundingClientRect();
  return {
    popupShown: popup.classList.contains('show'),
    popupPosition: getComputedStyle(popup).position,
    popupRect: { t: Math.round(popup.getBoundingClientRect().top), h: Math.round(popup.getBoundingClientRect().height) },
    swatchCount: swatches.length,
    swatchBg: sw.style.background,
    tap: { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) },
    barVisible: c.querySelector('.mobile-sel-bar--text').offsetHeight > 0,
    kbOpen: c.classList.contains('is-keyboard-open'),
    focus: app.workspace.activeLeaf.view.editor.view.hasFocus(),
  };
})()`, undefined, { timeout: 20000 }));
const swTap = R['text.popupOpen'].tap;
await touch(swTap.x, swTap.y);
await sleep(600);
step('text.applied', await page.evaluate(`(() => {
  const view = app.workspace.activeLeaf.view;
  const ed = view.editor;
  const c = view.contentEl;
  const popup = c.querySelector('.mobile-sel-bar--text .bb-dd-popup');
  const layer = c.querySelector('.bubble-menu-layer--styles');
  const pm = c.querySelector('.ProseMirror');
  const colored = [...pm.querySelectorAll('span')].find((el) => (el.style.color || '').includes('#') || /^rgb/.test(el.style.color));
  return {
    textStyleColor: ed.getAttributes('textStyle').color ?? null,
    popupClosed: popup ? !popup.classList.contains('show') : null,
    layerStillShown: layer?.classList.contains('show') ?? false,
    barVisible: c.querySelector('.mobile-sel-bar--text').offsetHeight > 0,
    domSpanColor: colored ? colored.style.color : null,
  };
})()`, undefined, { timeout: 20000 }));
// compare applied vs swatch (hex → rgb)
{
  const a = R['text.applied'].textStyleColor;
  const b = R['text.popupOpen'].swatchBg;
  const hex = /^#([0-9a-f]{6})$/i.exec(a ?? '');
  const rgb = b?.match(/\d+/g)?.map(Number);
  R.textAppliedMatchesSwatch = !!(hex && rgb && [1, 3, 5].map((i) => parseInt(hex[1].slice(i - 1, i + 1), 16)).every((v, i) => Math.abs(v - rgb[i]) <= 1));
  console.log('textAppliedMatchesSwatch: ' + R.textAppliedMatchesSwatch);
}

// ── TEXT: hex flow ──
const hexT = await target(`app.workspace.activeLeaf.view.contentEl.querySelector('.mobile-sel-bar--text .bb-dd-hex')`, 'text .bb-dd-hex');
await touch(hexT.x, hexT.y);
await sleep(700);
step('text.hexFocused', await page.evaluate(`(() => {
  const c = app.workspace.activeLeaf.view.contentEl;
  return {
    barVisible: c.querySelector('.mobile-sel-bar--text').offsetHeight > 0,
    layerShown: c.querySelector('.bubble-menu-layer--styles')?.classList.contains('show') ?? false,
    activeIsHex: document.activeElement === c.querySelector('.mobile-sel-bar--text .bb-dd-hex'),
    kbOpen: c.classList.contains('is-keyboard-open'),
  };
})()`, undefined, { timeout: 20000 }));
{
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.insertText', { text: '#12b0fe' });
  await sleep(200);
  for (const type of ['keyDown', 'keyUp']) {
    await cdp.send('Input.dispatchKeyEvent', { type, key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
  }
  await cdp.detach().catch(() => {});
}
await sleep(500);
step('text.hexApplied', await page.evaluate(`(() => {
  const view = app.workspace.activeLeaf.view;
  const c = view.contentEl;
  return {
    textStyleColor: view.editor.getAttributes('textStyle').color ?? null,
    barVisible: c.querySelector('.mobile-sel-bar--text').offsetHeight > 0,
    layerShown: c.querySelector('.bubble-menu-layer--styles')?.classList.contains('show') ?? false,
  };
})()`, undefined, { timeout: 20000 }));

// ── TABLE: cell fill flow ──
// collapse the text selection first: the open Styles layer covers the table
// and would swallow the cell tap; an empty caret hides the text bar
step('table.reset', await page.evaluate(`(() => {
  const view = app.workspace.activeLeaf.view;
  const ed = view.editor;
  ed.commands.focus();
  ed.commands.setTextSelection({ from: 1, to: 1 });
  const td = view.contentEl.querySelector('.ProseMirror td, .ProseMirror th');
  td?.scrollIntoView({ block: 'center' });
  return new Promise((res) => setTimeout(() => res({
    textBarActive: view.contentEl.querySelector('.mobile-sel-bar--text')?.classList.contains('is-active') ?? false,
  }), 400));
})()`, undefined, { timeout: 20000 }));
await sleep(300);
const cellT = await targetWithRetry(`app.workspace.activeLeaf.view.contentEl.querySelector('.ProseMirror td, .ProseMirror th')`, 'table cell');
await touch(cellT.x, cellT.y);
await sleep(800);
step('table.mode', await page.evaluate(`(() => {
  const c = app.workspace.activeLeaf.view.contentEl;
  const bar = c.querySelector('.mobile-sel-bar--table');
  return { barActive: bar?.classList.contains('is-active') ?? false, barVisible: bar ? bar.offsetHeight > 0 : false, kbOpen: c.classList.contains('is-keyboard-open'), focus: app.workspace.activeLeaf.view.editor.view.hasFocus() };
})()`, undefined, { timeout: 20000 }));
step('table.fillOpen', await page.evaluate(`(() => new Promise((res) => setTimeout(() => {
  const view = app.workspace.activeLeaf.view;
  const btn = view.contentEl.querySelector('.mobile-sel-bar--table button[data-tip="Cell fill"]');
  if (!btn) { res({ error: 'no Cell fill button' }); return; }
  btn.click();
  setTimeout(() => {
    const c = view.contentEl;
    res({
      barVisible: c.querySelector('.mobile-sel-bar--table').offsetHeight > 0,
      customBtn: !!c.querySelector('.mobile-sel-bar--table .bb-dd-open'),
      nativeInput: !!c.querySelector('.mobile-sel-bar--table .bb-dd-custom input[type=color]'),
      kbOpen: c.classList.contains('is-keyboard-open'),
      focus: view.editor.view.hasFocus(),
    });
  }, 500);
}, 350)))()`, undefined, { timeout: 20000 }));
const fillBtn = await target(`app.workspace.activeLeaf.view.contentEl.querySelector('.mobile-sel-bar--table .bb-dd-open')`, 'table .bb-dd-open');
await touch(fillBtn.x, fillBtn.y);
await sleep(400);
const fillSw = await target(`app.workspace.activeLeaf.view.contentEl.querySelectorAll('.mobile-sel-bar--table .bb-dd-popup.show .bb-sw')[25]`, 'fill swatch');
step('table.popup', { open: true, swatch: fillSw });
await touch(fillSw.x, fillSw.y);
await sleep(600);
step('table.applied', await page.evaluate(`(() => {
  const c = app.workspace.activeLeaf.view.contentEl;
  const td = c.querySelector('.ProseMirror td, .ProseMirror th');
  return {
    popupClosed: !c.querySelector('.mobile-sel-bar--table .bb-dd-popup')?.classList.contains('show'),
    cellBg: td ? getComputedStyle(td).backgroundColor : null,
    barVisible: c.querySelector('.mobile-sel-bar--table').offsetHeight > 0,
  };
})()`, undefined, { timeout: 20000 }));

// ── TABLE: borders pen flow (custom row lives in the Border color dropdown) ──
step('table.bordersOpen', await page.evaluate(`(() => new Promise((res) => setTimeout(() => {
  const view = app.workspace.activeLeaf.view;
  const btn = view.contentEl.querySelector('.mobile-sel-bar--table button[data-tip="Borders"]');
  if (!btn) { res({ error: 'no Borders button' }); return; }
  btn.click();
  setTimeout(() => {
    const c = view.contentEl;
    const sel = c.querySelector('.mobile-sel-bar--table .bubble-menu-layer--table-borders button[aria-label="Border color"]');
    if (!sel) { res({ error: 'no Border color selector' }); return; }
    sel.click();
    setTimeout(() => {
      const dd = c.querySelector('.mobile-sel-bar--table .bubble-menu-layer--table-borders .bb-dd');
      res({
        ddShown: !!dd && dd.offsetHeight > 0,
        customBtn: !!dd?.querySelector('.bb-dd-open'),
        nativeInput: !!dd?.querySelector('.bb-dd-custom input[type=color]'),
        barVisible: c.querySelector('.mobile-sel-bar--table').offsetHeight > 0,
      });
    }, 500);
  }, 500);
}, 350)))()`, undefined, { timeout: 20000 }));
const penBtn = await target(`app.workspace.activeLeaf.view.contentEl.querySelector('.mobile-sel-bar--table .bubble-menu-layer--table-borders .bb-dd .bb-dd-open')`, 'pen .bb-dd-open');
await touch(penBtn.x, penBtn.y);
await sleep(400);
const penSw = await target(`app.workspace.activeLeaf.view.contentEl.querySelectorAll('.mobile-sel-bar--table .bb-dd-popup.show .bb-sw')[25]`, 'pen swatch');
step('table.penPopup', { open: true, swatch: penSw });
await touch(penSw.x, penSw.y);
await sleep(600);
step('table.penApplied', await page.evaluate(`(() => new Promise((res) => setTimeout(() => {
  const c = app.workspace.activeLeaf.view.contentEl;
  const popupClosed = !c.querySelector('.mobile-sel-bar--table .bb-dd-popup')?.classList.contains('show');
  const barVisible = c.querySelector('.mobile-sel-bar--table').offsetHeight > 0;
  // choosing a pen closes the Border color dropdown — re-open it and read
  // the picker button background (it mirrors the current pen color)
  const sel = c.querySelector('.mobile-sel-bar--table .bubble-menu-layer--table-borders button[aria-label="Border color"]');
  sel?.click();
  setTimeout(() => {
    const open = c.querySelector('.mobile-sel-bar--table .bubble-menu-layer--table-borders .bb-dd .bb-dd-open');
    res({ popupClosed, barVisible, penBtnBg: open?.style.background ?? null });
  }, 500);
}, 400)))()`, undefined, { timeout: 20000 }));

// screenshot evidence
try {
  const shot = await page.$('.note-view-container:not(.hidden) .view-content');
  const el = shot ?? (await page.$('.workspace-leaf.mod-active .view-content'));
  if (el) await el.screenshot({ path: 'local/color-picker-verify-android.png' });
  console.log('screenshot: local/color-picker-verify-android.png');
} catch (e) { console.log('screenshot failed: ' + String(e).slice(0, 100)); }
console.log('RESULT_JSON ' + JSON.stringify(R, null, 1));
await browser.close().catch(() => {});
