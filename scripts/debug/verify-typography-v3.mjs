// verify-typography-v3.mjs — computed-style and rendered-gap measurements of
// the vertical-rhythm v3 specimen note (task typography-v3).
//
// Usage: node scripts/debug/verify-typography-v3.mjs <label> [platform]
//   label    output prefix: JSON/screenshot go to local/typography-v3-<label>.*
//   platform "android" targets the mobile app over CDP :9224 (npm run
//            android:debug first); default is desktop over CDP :9223.
//
// The desktop vault is verified by root path before any interaction
// (rule-verify-vault); on Android the plugin's test vault (TestVault) is the
// established mobile target of the repo's verify-* probes.
// Prints one JSON object: computed styles of h1–h4/p/ul/li>p/blockquote/hr,
// rendered gaps between adjacent top-level blocks, and list item gaps.
// Screenshot: desktop — element shot over CDP; android — adb screencap.
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const label = process.argv[2] ?? 'run';
const platform = process.argv[3] === 'android' ? 'android' : 'desktop';

const endpoint = platform === 'android' ? 'http://127.0.0.1:9224' : 'http://127.0.0.1:9223';
const pageUrlPrefix = platform === 'android' ? 'http://localhost/' : 'app://obsidian.md';
const devVault = '/Users/d.sumbaev/DEVELOPMENT/inscriptum/obsidian-plugin';

const browser = await chromium.connectOverCDP(endpoint, { timeout: 8000 });
const page = browser
  .contexts()
  .flatMap((c) => c.pages())
  .find((p) => p.url().startsWith(pageUrlPrefix));
if (page == null) {
  console.error(`no Obsidian page (${pageUrlPrefix}) on ${endpoint}`);
  process.exit(1);
}

const body = `(async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const base = app.vault.adapter.basePath;
  const isDevVault = base === ${JSON.stringify(devVault)};
  if (!isDevVault && ${JSON.stringify(platform)} !== 'android') {
    return { error: 'wrong vault: ' + base };
  }
  const fileName = app.vault
    .getFiles()
    .find((f) => f.name === 'Typography v3 specimen.note');
  if (fileName) {
    const leaf = app.workspace.getLeaf('tab');
    await leaf.openFile(fileName);
    app.workspace.setActiveLeaf(leaf, { focus: true });
  } else {
    const open = app.workspace
      .getLeavesOfType('note-view')
      .find((l) => l.view && l.view.file && l.view.file.name === 'Typography v3 specimen.note');
    if (!open) return { error: 'specimen neither indexed nor open' };
    app.workspace.setActiveLeaf(open, { focus: true });
  }
  await sleep(900);
  // Take the visible .note (inactive tabs render display:none, which zeroes
  // rects and computed-gap math); fall back to any text match.
  const visible = (n) => n.getBoundingClientRect().height > 0;
  const el =
    [...document.querySelectorAll('.note')].find(
      (n) => visible(n) && n.textContent.includes('Typography v3 specimen'),
    ) ??
    [...document.querySelectorAll('.note')].find((n) =>
      n.textContent.includes('Typography v3 specimen'),
    );
  if (!el) return { error: 'specimen note is not rendered' };
  if (!visible(el)) return { error: 'specimen note found but not visible' };
  document
    .querySelectorAll('[data-typo-probe]')
    .forEach((n) => n.removeAttribute('data-typo-probe'));
  el.dataset.typoProbe = ${JSON.stringify(label)};
  const pm = el.querySelector('.ProseMirror');
  if (!pm) return { error: 'no ProseMirror in specimen' };

  const cs = (sel, props) => {
    const node = el.querySelector(sel);
    if (!node) return null;
    const s = getComputedStyle(node);
    return Object.fromEntries(props.map((p) => [p, s[p]]));
  };
  const styles = {
    h1: cs('h1', ['fontSize', 'fontWeight', 'marginTop', 'marginBottom']),
    h2: cs('h2', ['fontSize', 'marginTop', 'marginBottom']),
    h3: cs('h3', ['fontSize', 'marginTop', 'marginBottom']),
    h4: cs('h4', ['fontSize', 'marginTop', 'marginBottom']),
    p: cs('.ProseMirror > p', ['fontSize', 'lineHeight', 'marginTop', 'marginBottom', 'paddingTop', 'paddingBottom']),
    li_p: cs('li > p', ['marginTop', 'marginBottom', 'paddingTop', 'paddingBottom']),
    ul: cs('ul:not([data-type="taskList"])', ['marginTop', 'marginBottom']),
    blockquote: cs('blockquote', ['marginTop', 'marginBottom']),
    blockquote_p: cs('blockquote p', ['marginTop', 'marginBottom', 'paddingTop', 'paddingBottom']),
    hr: cs('hr', ['marginTop', 'marginBottom', 'borderTopWidth']),
  };

  // Rendered gap between adjacent top-level blocks: next.top - prev.bottom.
  // Margins do not count into boxes, so this is the visible spacing.
  const blocks = [...pm.children].filter((b) => b.getBoundingClientRect().height > 0);
  const name = (b) =>
    b.tagName.toLowerCase() +
    (b.dataset.type ? '[' + b.dataset.type + ']' : '') +
    (b.classList.length ? '.' + b.classList[0] : '');
  const gaps = [];
  for (let i = 1; i < blocks.length; i++) {
    const prev = blocks[i - 1].getBoundingClientRect();
    const cur = blocks[i].getBoundingClientRect();
    gaps.push({
      between: name(blocks[i - 1]) + ' > ' + name(blocks[i]),
      px: Math.round(cur.top - prev.bottom),
    });
  }
  const lis = [...el.querySelectorAll('ul > li')].map((li) => li.getBoundingClientRect());
  const itemGaps = [];
  for (let i = 1; i < lis.length; i++) {
    itemGaps.push({ between: 'li > li', px: Math.round(lis[i].top - lis[i - 1].bottom) });
  }
  return { platform: ${JSON.stringify(platform)}, vault: base, styles, gaps, itemGaps };
})()`;

const result = await page.evaluate(body);
console.log(JSON.stringify(result, null, 2));

const shot = `local/typography-v3-${label}.png`;
if (platform === 'android') {
  fs.mkdirSync('local', { recursive: true });
  const png = execFileSync('adb', ['exec-out', 'screencap', '-p'], { stdio: ['ignore', 'pipe', 'ignore'] });
  fs.writeFileSync(shot, png);
  console.log('screenshot (device screen): ' + shot);
} else {
  const probe = page.locator('[data-typo-probe="' + label + '"]');
  try {
    await probe.screenshot({ path: shot, timeout: 15000 });
    console.log('screenshot: ' + shot);
  } catch (err) {
    console.log('screenshot failed: ' + err.message.split('\n')[0]);
  }
}
await browser.close().catch(() => {});
