/**
 * Live verification of the community-review CSS refactor (task
 * obsidian-review-cleanup) in a REAL Chromium via the repo's browser
 * harness (action-browser-harness): the harness page loads the actual
 * editor bundle and the actual editor.css chain.
 *
 * Checks:
 *  A. folded body is hidden  (.note .ProseMirror .texto-folded-content)
 *  B. table cell border cascade: plugin default -> inline cell border ->
 *     "No borders" preset (data-borders="none") + inline cell border
 *  C. fold chevron: hover reveals it (opacity 1) -> hold-grab (.is-grabbed)
 *     hides it again (opacity 0) — the rule the !important removal touched
 *  D. note-property gap: column-gap 16px, row-gap 0
 *  E. scrollbar hiding: no classic scrollbar space on the name column
 */
import { chromium } from "playwright-core";

const URL = process.env.HARNESS_URL ?? "http://localhost:8791/.harness/index.html";
const SHOTS = process.env.SHOT_DIR ?? "/tmp/rev-shots";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text()}`);
});

await page.goto(URL, { waitUntil: "load" });
await page.waitForFunction(() => window.__harness != null, null, { timeout: 20000 });
await page.waitForTimeout(400);

const out = {};

// ── A. folded body hidden ───────────────────────────────────────────────
out.A_fold = await page.evaluate(() => {
  const h = window.__harness;
  const headingPos = h.positions.find((p) => {
    const node = h.view.state.doc.nodeAt(p);
    return node != null && node.type.name === "heading";
  });
  h.foldHeading(headingPos);
  const folded = document.querySelector(".note .ProseMirror .texto-folded-content");
  return {
    foldedNodeFound: folded != null,
    display: folded == null ? null : getComputedStyle(folded).display,
    height: folded == null ? null : folded.getBoundingClientRect().height,
  };
});

// ── B. table cell border cascade ────────────────────────────────────────
out.B_table = await page.evaluate(() => {
  const host = document.createElement("div");
  host.className = "note";
  const pm = document.createElement("div");
  pm.className = "ProseMirror";
  const wrap = document.createElement("div");
  wrap.className = "table-wrapper";
  const table = document.createElement("table");
  const tbody = document.createElement("tbody");
  const tr = document.createElement("tr");
  const td = document.createElement("td");
  td.textContent = "cell";
  tr.appendChild(td);
  tbody.appendChild(tr);
  table.appendChild(tbody);
  wrap.appendChild(table);
  pm.appendChild(wrap);
  host.appendChild(pm);
  document.body.appendChild(host);

  const read = () => {
    const cs = getComputedStyle(td);
    return {
      borderTop: cs.borderTopWidth + " " + cs.borderTopStyle,
      borderBottom: cs.borderBottomWidth + " " + cs.borderBottomStyle,
    };
  };

  const pluginDefault = read();

  // per-cell inline border (what the `borders` attr renders)
  td.style.borderTop = "1.5pt solid #b3a3f7";
  const withInline = read();

  // "No borders" preset: the stylesheet suppresses the grid for every cell
  table.setAttribute("data-borders", "none");
  const presetNoBorder = read();

  return { pluginDefault, withInline, presetNoBorder };
});

// ── C. fold chevron: hover reveals, hold-grab hides ─────────────────────
const heading = page.locator(".note .ProseMirror h1").first();
await heading.hover();
await page.waitForTimeout(150);
out.C_chevron = await page.evaluate(() => {
  const host = document.querySelector(".note .texto-heading-fold-chevron-host");
  if (host == null) return { found: false };
  const before = getComputedStyle(host).opacity;
  // the plugin adds `is-grabbed` on the chevron host for the hold-grab state
  host.classList.add("is-grabbed");
  const grabbed = getComputedStyle(host).opacity;
  host.classList.add("is-dragging");
  const dragging = getComputedStyle(host).opacity;
  host.classList.remove("is-grabbed", "is-dragging");
  const released = getComputedStyle(host).opacity;
  return { found: true, before, grabbed, dragging, released };
});

// task-item chevron (own rule set in task-item/style.css): the plugin
// toggles is-hover / is-grabbed on the chevron element itself — the
// hold-grab state must win over the reveal rule without !important.
out.C_taskChevron = await page.evaluate(() => {
  const chevron = document.querySelector(
    ".texto-extension-task-item-host .texto-task-fold-chevron",
  );
  if (chevron == null) return { found: false };
  const idle = getComputedStyle(chevron).opacity;
  chevron.classList.add("is-hover");
  const forceRevealed = getComputedStyle(chevron).opacity;
  chevron.classList.add("is-grabbed");
  const grabbed = getComputedStyle(chevron).opacity;
  chevron.classList.add("is-dragging");
  const dragging = getComputedStyle(chevron).opacity;
  chevron.classList.remove("is-grabbed", "is-dragging", "is-hover");
  return { found: true, idle, forceRevealed, grabbed, dragging };
});

// ProseMirror block separator: the rule keeps !important on purpose
out.E_separator = await page.evaluate(() => {
  const img = document.querySelector("img.ProseMirror-separator");
  if (img == null) return { found: false };
  const cs = getComputedStyle(img);
  return { found: true, display: cs.display, width: cs.width, height: cs.height };
});

// ── D. note-property gap ────────────────────────────────────────────────
out.D_notePropertyGap = await page.evaluate(() => {
  const host = document.createElement("div");
  host.className = "note";
  const pm = document.createElement("div");
  pm.className = "ProseMirror";
  const prop = document.createElement("div");
  prop.className = "note-property";
  const name = document.createElement("div");
  name.className = "note-property-name";
  name.textContent = "a very long property name that must scroll inside its column";
  prop.appendChild(name);
  pm.appendChild(prop);
  host.appendChild(pm);
  document.body.appendChild(host);
  const cs = getComputedStyle(prop);
  // classic scrollbars take space in Chromium: hidden scrollbar => no gap
  const scrollbarSpace = name.offsetWidth - name.clientWidth;
  return {
    columnGap: cs.columnGap,
    rowGap: cs.rowGap,
    nameScrollbarSpace: scrollbarSpace,
  };
});

await page.screenshot({ path: `${SHOTS}/harness-editor.png`, fullPage: false });

console.log(JSON.stringify({ out, errors }, null, 2));
await browser.close();
