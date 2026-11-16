// verify-bubble-layer-visibility.mjs — desktop verification of the floating
// bubble menu placement fix (task bubble-layer-visibility, owner strategy B).
//
// Usage: node scripts/debug/verify-bubble-layer-visibility.mjs <label>
//
// Scenarios (real CDP interactions in the dev vault, rule-verify-vault):
//   A. selection in the first row → the bar opens BELOW the selection and
//      never covers the note toolbar (the reported bug)
//   B. mid-content selection → the bar stays above the selection (default
//      flip behavior unchanged)
//   C. styles layer at the top → measured from the toolbar bottom; fully
//      inside the toolbar/window boundaries
//   D. reduced window height + styles layer at the top → the layer is
//      capped with an inner scroll; every pixel inside the bounds
//   E. link layer mid-content → still opens below the bar (no regression)
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';

const label = process.argv[2] ?? 'run';
const devVault = '/Users/d.sumbaev/DEVELOPMENT/inscriptum/obsidian-plugin';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9223', { timeout: 8000 });
const windows = [];
let page = null;
for (const p of browser.contexts().flatMap((c) => c.pages())) {
  if (!p.url().startsWith('app://obsidian.md')) continue;
  let base = null;
  try {
    base = await p.evaluate(() => { try { return window.app?.vault?.adapter?.basePath ?? null; } catch { return null; } }, undefined, { timeout: 10000 });
  } catch { base = 'unreachable'; }
  windows.push(base);
  if (base === devVault) page = p;
}
if (!page) { console.log(JSON.stringify({ ok: false, windows })); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// select a range and open/close layers, all measured from the page
const select = (from, to) => page.evaluate(`(() => {
  const view = app.workspace.activeLeaf.view;
  const ed = view.editor;
  // scroll the block into view first: a selection of an off-screen block
  // places the popper off-screen (no real user flow selects invisibly)
  let target = null, count = -1;
  ed.state.doc.descendants((node, p) => {
    if (node.type.name === 'paragraph' || node.type.name === 'heading') {
      count += 1;
      if (p + 1 === ${from} && !target) {
        const pm = view.contentEl.querySelector('.ProseMirror');
        let i = -1;
        for (const el of pm.children) {
          if (['P', 'H1', 'H2', 'H3'].includes(el.tagName)) { i += 1; if (i === count) { target = el; break; } }
        }
      }
    }
    return !target;
  });
  target?.scrollIntoView({ block: 'center' });
  ed.commands.focus();
  ed.commands.setTextSelection({ from: ${from}, to: ${to} });
  return ed.state.selection.from;
})()`, undefined, { timeout: 15000 });

const hideBar = () => page.evaluate(`(() => {
  const view = app.workspace.activeLeaf.view;
  view.editor.commands.setTextSelection({ from: 1, to: 1 });
  return null;
})()`, undefined, { timeout: 15000 }).then(() => sleep(400));

const closeLayer = () => page.evaluate(`(() => {
  const btn = app.workspace.activeLeaf.view.contentEl.querySelector('.bubble-menu-bar button[data-tip="Styles & color"]');
  if (btn?.classList.contains('is-active')) btn.click();
  return null;
})()`, undefined, { timeout: 15000 });

const barState = `(() => {
  const c = app.workspace.activeLeaf.view.contentEl;
  const toolbar = c.querySelector('.note-toolbar-host');
  const popper = document.querySelector('.bubble-menu-popper');
  const bar = popper?.querySelector('.bubble-menu-bar');
  const layer = bar?.querySelector('.bubble-menu-layer--styles');
  const link = bar?.querySelector('.bubble-menu-layer--link');
  const linkShown = link?.classList.contains('show') ?? false;
  const r = (el) => { const b = el?.getBoundingClientRect(); return b ? { t: Math.round(b.top), b: Math.round(b.bottom), l: Math.round(b.left), rr: Math.round(b.right), h: Math.round(b.height) } : null; };
  const ed = app.workspace.activeLeaf.view.editor;
  const sel = ed.state.selection;
  const ref = { from: sel.from, to: sel.to };
  return {
    toolbar: r(toolbar),
    bar: r(bar),
    layer: r(layer),
    linkRect: linkShown ? r(link) : null,
    layerOpenDown: bar?.classList.contains('layer-open-down') ?? null,
    layerCapped: layer?.classList.contains('layer-capped') ?? null,
    layerScrollable: layer ? layer.scrollHeight > layer.clientHeight : null,
    linkLayerShown: link?.classList.contains('show') ?? null,
    sel: ref,
    innerH: innerHeight,
    visible: bar ? bar.offsetHeight > 0 : false,
  };
})()`;

// ── setup: note with a heading first block + long paragraphs ──
await page.evaluate(`(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const vault = app.vault;
  const NOTE = 'local/bubble-layer-verify.note';
  let n = 0;
  const mk = () => 'blv' + (n++).toString(36).padStart(7, '0');
  const h = (lvl, t) => ({ type: 'heading', attrs: { id: mk(), level: lvl, align: null }, content: [{ type: 'text', text: t }] });
  const para = (t) => ({ type: 'paragraph', attrs: { id: mk(), align: null }, content: [{ type: 'text', text: t }] });
  const LONG = 'Alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu. ';
  const doc = { type: 'noteDoc', content: [
    { type: 'noteTitle', attrs: { id: mk() }, content: [{ type: 'text', text: 'bubble-layer-verify' }] },
    h(1, 'First row heading for the bar bug'),
    para(LONG), para(LONG), para(LONG), para(LONG), para(LONG), para(LONG),
  ] };
  const raw = JSON.stringify(doc, null, 2);
  const existing = vault.getAbstractFileByPath(NOTE);
  if (existing) await vault.modify(existing, raw); else await vault.create(NOTE, raw);
  const leaf = app.workspace.getLeaf('tab');
  await leaf.openFile(vault.getAbstractFileByPath(NOTE));
  app.workspace.setActiveLeaf(leaf, { focus: true });
  await sleep(700);
  const ed = app.workspace.activeLeaf.view.editor;
  ed.commands.setTextSelection({ from: 1, to: 1 });
  ed.commands.blur();
  await sleep(400);
  // block positions for selections
  const pos = { paras: [] };
  ed.state.doc.descendants((node, p) => {
    if (node.type.name === 'heading' && pos.h1 == null) pos.h1 = { from: p + 1, to: p + node.content.size };
    if (node.type.name === 'paragraph') pos.paras.push({ from: p + 1, to: p + Math.min(40, node.content.size) });
    return true;
  });
  pos.p1 = pos.paras[0]; pos.p2 = pos.paras[1]; pos.p3 = pos.paras[2];
  window.__blvPos = pos;
  return pos;
})()`, undefined, { timeout: 30000 }).then((v) => console.log('positions:', JSON.stringify(v)));

const R = {};
const step = (name, v) => { R[name] = v; console.log(name + ': ' + JSON.stringify(v)); };

// ── A: selection in the first row (heading) → bar BELOW, toolbar untouched ──
{
  const pos = await page.evaluate('window.__blvPos');
  await select(pos.h1.from, pos.h1.to);
  await sleep(900); // debounce 250ms + tippy
  const st = await page.evaluate(barState, undefined, { timeout: 15000 });
  st.barBelowSelection = st.bar ? st.bar.t > 0 : false;
  step('A.firstRow', st);
  try {
    const shot = await page.$('.workspace-leaf.mod-active .view-content');
    if (shot) await shot.screenshot({ path: `local/bubble-layer-A-firstrow.png` });
  } catch {}
  await hideBar();
}

// ── B: mid-content selection → bar above (default behavior) ──
{
  const pos = await page.evaluate('window.__blvPos');
  await select(pos.p3.from, pos.p3.to);
  await sleep(900);
  const st = await page.evaluate(barState, undefined, { timeout: 15000 });
  step('B.midContent', st);
  await hideBar();
}

// ── C: styles layer with the selection in the first row ──
{
  const pos = await page.evaluate('window.__blvPos');
  await select(pos.h1.from, pos.h1.to);
  await sleep(900);
  await page.evaluate(`(() => {
    const btn = app.workspace.activeLeaf.view.contentEl.querySelector('.bubble-menu-bar button[data-tip="Styles & color"]');
    btn?.click();
    return null;
  })()`, undefined, { timeout: 15000 });
  await sleep(600);
  const st = await page.evaluate(barState, undefined, { timeout: 15000 });
  step('C.layerTop', st);
  try {
    const shot = await page.$('.workspace-leaf.mod-active .view-content');
    if (shot) await shot.screenshot({ path: `local/bubble-layer-C-layertop.png` });
  } catch {}
  await closeLayer();
  await hideBar();
}

// ── D: reduced window height + layer at the top → cap with inner scroll ──
let restored = null;
try {
  const cdp = await page.context().newCDPSession(page);
  const before = await page.evaluate('({ w: innerWidth, h: innerHeight })');
  // Electron exposes no Browser.getWindowForTarget — emulate a short
  // viewport instead (reverted right after the scenario)
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: before.w, height: 480, deviceScaleFactor: 0, mobile: false });
  await sleep(900);
  const after = await page.evaluate('({ w: innerWidth, h: innerHeight })');
  restored = async () => {
    await cdp.send('Emulation.clearDeviceMetricsOverride');
    await sleep(600);
  };
  step('D.resize', { before, after });
  if (after.h < 600) {
    const pos = await page.evaluate('window.__blvPos');
    await select(pos.h1.from, pos.h1.to);
    await sleep(900);
    await page.evaluate(`(() => {
      const btn = app.workspace.activeLeaf.view.contentEl.querySelector('.bubble-menu-bar button[data-tip="Styles & color"]');
      btn?.click();
      return null;
    })()`, undefined, { timeout: 15000 });
    await sleep(600);
    const st = await page.evaluate(barState, undefined, { timeout: 15000 });
    step('D.cappedLayer', st);
    try {
      const shot = await page.$('.workspace-leaf.mod-active .view-content');
      if (shot) await shot.screenshot({ path: `local/bubble-layer-D-capped.png` });
    } catch {}
    await closeLayer();
    await hideBar();
  }
  await restored();
} catch (e) {
  step('D.error', String(e).slice(0, 140));
  if (restored) await restored();
}

// ── F: stale-cap blocker repro — cap once, then reopen at several places ──
try {
  const cdp = await page.context().newCDPSession(page);
  const before = await page.evaluate('({ w: innerWidth, h: innerHeight })');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: before.w, height: 480, deviceScaleFactor: 0, mobile: false });
  await sleep(900);
  const pos = await page.evaluate('window.__blvPos');
  const results = [];
  // open+cap once at the first paragraph
  await select(pos.paras[0].from, pos.paras[0].to);
  await sleep(900);
  await page.evaluate(`(() => {
    app.workspace.activeLeaf.view.contentEl.querySelector('.bubble-menu-bar button[data-tip="Styles & color"]')?.click();
    return null;
  })()`, undefined, { timeout: 15000 });
  await sleep(500);
  const cappedState = await page.evaluate(barState, undefined, { timeout: 15000 });
  results.push({ phase: 'cap-once', capped: cappedState.layerCapped, inBounds: cappedState.layer ? cappedState.layer.t >= cappedState.toolbar.b && cappedState.layer.b <= cappedState.innerH : null });
  await closeLayer();
  // reopen at every other paragraph: the layer must stay inside the bounds
  for (let i = 1; i < Math.min(pos.paras.length, 6); i++) {
    await select(pos.paras[i].from, pos.paras[i].to);
    await sleep(800);
    await page.evaluate(`(() => {
      app.workspace.activeLeaf.view.contentEl.querySelector('.bubble-menu-bar button[data-tip="Styles & color"]')?.click();
      return null;
    })()`, undefined, { timeout: 15000 });
    await sleep(500);
    const st = await page.evaluate(barState, undefined, { timeout: 15000 });
    results.push({
      phase: 'reopen-' + i,
      layerT: st.layer?.t, layerB: st.layer?.b, toolbarB: st.toolbar?.b, innerH: st.innerH,
      inBounds: st.layer ? st.layer.t >= st.toolbar.b && st.layer.b <= st.innerH : null,
      capped: st.layerCapped, scrollable: st.layerScrollable,
    });
    await closeLayer();
  }
  step('F.staleCap', results);
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  await sleep(600);
} catch (e) {
  step('F.error', String(e).slice(0, 140));
  await page.evaluate('(() => { const c = app.workspace.activeLeaf?.view?.contentEl; if (c) { const b = c.querySelector(\'.bubble-menu-bar button[data-tip="Styles & color"]\'); if (b?.classList.contains(\'is-active\')) b.click(); } return null; })()').catch(() => {});
  await page.emulateMedia?.({}).catch?.(() => {});
}

// ── G: hide as the last resort — degenerate viewport where neither side fits ──
try {
  const cdp = await page.context().newCDPSession(page);
  const before = await page.evaluate('({ w: innerWidth, h: innerHeight })');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: before.w, height: 150, deviceScaleFactor: 0, mobile: false });
  await sleep(900);
  const pos = await page.evaluate('window.__blvPos');
  await select(pos.paras[0].from, pos.paras[0].to);
  await sleep(900);
  const st = await page.evaluate(barState, undefined, { timeout: 15000 });
  step('G.hideLastResort', { visible: st.visible, bar: st.bar, innerH: st.innerH, toolbar: st.toolbar });
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  await sleep(600);
  await hideBar();
} catch (e) {
  step('G.error', String(e).slice(0, 140));
  await page.evaluate('(() => { const c = app.workspace.activeLeaf?.view?.contentEl; if (c) { const b = c.querySelector(\'.bubble-menu-bar button[data-tip="Styles & color"]\'); if (b?.classList.contains(\'is-active\')) b.click(); } return null; })()').catch(() => {});
}

// ── E: link layer regression (always below the bar) ──
{
  const pos = await page.evaluate('window.__blvPos');
  await select(pos.p2.from, pos.p2.to);
  await sleep(900);
  await page.evaluate(`(() => {
    const btn = app.workspace.activeLeaf.view.contentEl.querySelector('.bubble-menu-bar button[data-tip="Link"]');
    btn?.click();
    return null;
  })()`, undefined, { timeout: 15000 });
  await sleep(600);
  const st = await page.evaluate(barState, undefined, { timeout: 15000 });
  st.linkInBounds = st.linkRect ? st.linkRect.t >= 0 && st.linkRect.b <= st.innerH : null;
  step('E.linkLayer', st);
  // close: press Escape via the bar's own handler
  await page.evaluate(`(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return null;
  })()`, undefined, { timeout: 15000 });
  await hideBar();
}

console.log('screenshot-prefix: local/bubble-layer-' + label);
await browser.close().catch(() => {});
