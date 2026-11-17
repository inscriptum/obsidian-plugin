// diag-color-picker-android.mjs — instrumented diagnosis of the mobile
// custom-color-picker bug (task mobile-color-picker-closes): tap the
// input[type=color] in the Styles layer with a REAL CDP touch and record the
// exact event chain that closes the picker / hides the bar.
//
// Usage: node scripts/debug/diag-color-picker-android.mjs
// Requires: npm run android:debug deployed and the forward to :9224 alive
// (the script re-establishes it via adb if it is gone).
//
// Sequence: open a scratch note with text → real tap on a word (editor
// focus + keyboard, like the user flow) → set a non-empty selection → open
// the Styles layer (synthetic click) → install in-page instrumentation
// (focusin/focusout, Capacitor keyboard events, 100ms state polling) →
// real touch on the color input → dump the recorded timeline + final state.
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const endpoint = process.env.ANDROID_CDP ?? 'http://127.0.0.1:9224';

// re-establish the adb forward (the app restart kills the old one)
try {
  const pid = execFileSync('adb', ['-s', 'emulator-5554', 'shell', 'pidof', 'md.obsidian'], { encoding: 'utf8' }).trim();
  execFileSync('adb', ['-s', 'emulator-5554', 'forward', `tcp:9224`, `localabstract:webview_devtools_remote_${pid}`]);
} catch (e) {
  console.error('adb forward failed: ' + String(e).slice(0, 120));
}

const browser = await chromium.connectOverCDP(endpoint, { timeout: 10000 });
const page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith('http://localhost/'));
if (!page) { console.error('Obsidian mobile page not found — run npm run android:debug first'); process.exit(1); }

// ── Step 1: create + open the scratch note, tap a word, set selection ──
const setup = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const vault = app.vault;
  const vaultName = vault.getName();
  if (vaultName !== 'TestVault') return { error: 'wrong vault: ' + vaultName };
  const plugin = !!app.plugins.getPlugin('inscriptum');
  const NOTE = 'local/color-picker-diag.note';
  const mk = (n) => 'diag' + (n++).toString(36).padStart(7, '0');
  let n = 0;
  const para = (t) => ({ type: 'paragraph', attrs: { id: mk(n++), align: null }, content: [{ type: 'text', text: t }] });
  const LONG = 'Alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu. ';
  const doc = { type: 'noteDoc', content: [
    { type: 'noteTitle', attrs: { id: mk(n++) }, content: [{ type: 'text', text: 'color-picker-diag' }] },
    para(LONG + LONG), para(LONG),
  ] };
  const raw = JSON.stringify(doc, null, 2);
  const existing = vault.getAbstractFileByPath(NOTE);
  if (existing) await vault.modify(existing, raw); else await vault.create(NOTE, raw);
  const leaf = app.workspace.getLeaf('tab');
  await leaf.openFile(vault.getAbstractFileByPath(NOTE));
  await sleep(600);
  // find the paragraph text rect for the real tap
  const pm = leaf.view?.contentEl?.querySelector('.ProseMirror');
  if (!pm) return { error: 'no ProseMirror' };
  const firstP = [...pm.children].find((el) => el.tagName === 'P');
  const r = firstP.getBoundingClientRect();
  return { ok: true, vaultName, plugin, tapX: Math.round(r.left + Math.min(120, r.width / 2)), tapY: Math.round(r.top + r.height / 2), pmRect: { w: Math.round(r.width), h: Math.round(r.height) } };
})()`;
const s = await page.evaluate(setup, undefined, { timeout: 30000 });
if (s.error) { console.log(JSON.stringify(s, null, 2)); process.exit(1); }
console.log('setup:', JSON.stringify(s));

// real tap on the text → editor focused, soft keyboard opens
{
  const cdp = await page.context().newCDPSession(page);
  const tap = async (x, y) => {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    await new Promise((r) => setTimeout(r, 80));
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };
  await tap(s.tapX, s.tapY);
  await new Promise((r) => setTimeout(r, 900)); // let the keyboard settle
  await cdp.detach().catch(() => {});
}

// ── Step 2: set selection, open the Styles layer, instrument, return input rect ──
const arm = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const leaf = app.workspace.getActiveViewOfType?.(Object) ?? app.workspace.activeLeaf;
  const view = app.workspace.activeLeaf?.view;
  const ed = view?.editor;
  if (!ed) return { error: 'no editor' };
  // non-empty selection across some words
  const docSize = ed.state.doc.content.size;
  ed.commands.setTextSelection({ from: 4, to: Math.min(60, docSize - 2) });
  await sleep(400);
  const contentEl = view.contentEl;
  const stylesBtn = contentEl.querySelector('button[data-tip="Styles & color"]');
  if (!stylesBtn) return { error: 'no styles button', barHtml: contentEl.querySelector('.mobile-sel-bar')?.className ?? null };
  stylesBtn.click();
  await sleep(500);
  const input = contentEl.querySelector('.bb-dd-custom input[type=color]');
  if (!input) return { error: 'no color input' };

  // ── in-page instrumentation ──
  const log = [];
  const t0 = performance.now();
  const rec = (kind, extra) => log.push({ t: Math.round(performance.now() - t0), kind, extra });
  window.__capDiag = { log, t0 };
  document.addEventListener('focusin', (e) => rec('focusin', (e.target.tagName || '') + '.' + (e.target.className || '').toString().slice(0, 40)), true);
  document.addEventListener('focusout', (e) => rec('focusout', (e.target.tagName || '') + ' → ' + (e.relatedTarget ? (e.relatedTarget.tagName || '?') : 'null')), true);
  document.addEventListener('input', (e) => rec('input', (e.target.tagName || '') + (e.target.type ? ':' + e.target.type : '')), true);
  document.addEventListener('change', (e) => rec('change', (e.target.tagName || '') + (e.target.type ? ':' + e.target.type : '')), true);
  const kb = window.Capacitor?.Plugins?.Keyboard;
  window.__capKbHandles = [];
  if (kb?.addListener) {
    for (const ev of ['keyboardWillShow', 'keyboardDidShow', 'keyboardWillHide', 'keyboardDidHide']) {
      try { window.__capKbHandles.push(await kb.addListener(ev, () => rec('kb', ev))); } catch {}
    }
  }
  const state = () => {
    const popper = document.querySelector('.bubble-menu-popper');
    const layer = contentEl.querySelector('.bubble-menu-layer--styles');
    const bar = contentEl.querySelector('.mobile-sel-bar');
    return {
      popperVisible: popper ? getComputedStyle(popper).visibility : null,
      layerShown: layer ? layer.classList.contains('show') : null,
      barShown: bar ? !bar.closest('[style*="display: none"]') && bar.offsetHeight > 0 : false,
      activeEl: (document.activeElement?.tagName || '') + (document.activeElement?.type ? ':' + document.activeElement.type : ''),
      editorFocus: ed?.view?.hasFocus?.() ?? null,
      selFrom: ed?.state?.selection?.from, selTo: ed?.state?.selection?.to,
    };
  };
  window.__capDiag.state = state;
  window.__capDiag.poll = setInterval(() => rec('poll', JSON.stringify(state())), 100);
  const r = input.getBoundingClientRect();
  return { ok: true, inputRect: { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height) }, coarse: matchMedia('(pointer: coarse)').matches, armed: state() };
})()`;
const a = await page.evaluate(arm, undefined, { timeout: 30000 });
if (a.error) { console.log(JSON.stringify(a, null, 2)); process.exit(1); }
console.log('armed:', JSON.stringify(a));

// ── Step 3: real touch on the color input ──
{
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.inputRect.x, y: a.inputRect.y, id: 1 }] });
  await new Promise((r) => setTimeout(r, 90));
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach().catch(() => {});
}

// ── Step 4: wait and dump the timeline ──
await new Promise((r) => setTimeout(r, 3500));
const dump = `(() => {
  const d = window.__capDiag;
  clearInterval(d.poll);
  for (const h of window.__capKbHandles ?? []) void h.remove?.();
  return { log: d.log, final: d.state() };
})()`;
const final = await page.evaluate(dump, undefined, { timeout: 30000 });
console.log(JSON.stringify(final, null, 2));
await browser.close().catch(() => {});
