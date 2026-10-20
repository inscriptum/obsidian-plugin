#!/usr/bin/env node
/** Regenerates `src/export/assets/note.css` — the self-contained stylesheet
 *  written next to index.html by "Export as website".
 *
 *  Composition (see src/export/assets/README.md):
 *    1. header comment + stylelint gate note (this script);
 *    2. @font-face rules with the fonts inlined as data URIs (reused from
 *       the current file — re-derive them from the blog assets when the
 *       fonts change, see README);
 *    3. the deployed inscriptum stylesheet (part 2), fetched from
 *       https://inscriptum.js.org/css/note.css (or `--from <file>`), with
 *       duplicate property declarations removed (keep-last — cascade
 *       equivalent, satisfies the stylelint duplicate-properties gate);
 *    4. the hand-maintained "Export additions" section, preserved verbatim
 *       from the current file.
 *
 *  The browser-feature warnings (text-decoration / display:contents /
 *  multicolumn) are intentionally kept: they are load-bearing styles of the
 *  published site, which targets more browsers than Obsidian's Chromium.
 *  The generated header carries a file-level stylelint-disable with this
 *  justification, so `npm run lint:css` stays clean without touching the
 *  upstream source.
 *
 *  Usage:
 *    node scripts/generate-note-css.mjs                 # fetch deployed CSS
 *    node scripts/generate-note-css.mjs --from old.css  # use a local copy
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const DEPLOYED_URL = "https://inscriptum.js.org/css/note.css";
const TARGET = fileURLToPath(
  new URL("../src/export/assets/note.css", import.meta.url),
);

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function fetchDeployed() {
  const from = argValue("--from");
  if (from) return readFile(from, "utf8");
  const res = await fetch(DEPLOYED_URL);
  if (!res.ok) {
    throw new Error(
      `${DEPLOYED_URL} responded ${res.status} — pass --from <file> with a locally saved copy`,
    );
  }
  return res.text();
}

/** Splits the current generated file into its parts, by line shape: the
 *  fonts line starts with "@font-face", the deployed blob is the single
 *  line starting with "/*! normalize.css", everything after it is the
 *  hand-maintained additions. */
function extractParts(current) {
  const lines = current.split("\n");
  const fontsIdx = lines.findIndex((l) => l.startsWith("@font-face"));
  const deployedIdx = lines.findIndex((l) => l.startsWith("/*! normalize.css"));
  if (fontsIdx < 0 || deployedIdx < 0 || deployedIdx < fontsIdx) {
    throw new Error(
      "cannot find the @font-face / deployed-css lines in the current note.css",
    );
  }
  return {
    fonts: lines[fontsIdx],
    additions: lines.slice(deployedIdx + 1).join("\n").replace(/^\n+/, ""),
  };
}

/** Removes duplicate property declarations inside each block, keeping the
 *  LAST occurrence (cascade-equivalent: the last declaration wins — an
 *  `!important` repeat only loses to a later `!important` of the same
 *  property, so importance is part of the dedup key), and drops legacy IE
 *  star-hack declarations (*prop — invalid in every modern browser and
 *  flagged as duplicates by the stylelint gate). Conservative guards: any
 *  block containing `url(` is left untouched (a `;` inside an unquoted
 *  data URI would break naive splitting), and the whole run fails when
 *  quotes and braces interleave in a way the splitter cannot see through —
 *  the maintainer then dedups that upstream change by hand. */
function dedupProperties(css) {
  for (let i = 0; i < css.length; i++) {
    const ch = css[i];
    if (ch === '"' || ch === "'") {
      const close = css.indexOf(ch, i + 1);
      if (close < 0) throw new Error("unbalanced quote in deployed css");
      const inner = css.slice(i + 1, close);
      if (/[{}]/.test(inner)) {
        throw new Error(
          "brace inside a quoted css value — dedup splitter cannot parse this safely; handle the upstream change manually",
        );
      }
      i = close;
    }
  }
  let removed = 0;
  const out = css.replace(/\{[^{}]*\}/g, (block) => {
    if (block.includes("url(")) return block;
    const inner = block.slice(1, -1);
    const decls = inner.split(";");
    const keyOf = (d) => {
      const colon = d.indexOf(":");
      if (colon < 0) return null;
      const prop = d.slice(0, colon).trim().toLowerCase();
      return prop ? `${prop}!${d.includes("!important") ? 1 : 0}` : null;
    };
    const lastIndex = new Map();
    decls.forEach((d, i) => {
      const key = keyOf(d);
      if (key) lastIndex.set(key, i);
    });
    const kept = decls.filter((d, i) => {
      const key = keyOf(d);
      if (!key) return d.trim() !== "";
      if (key.startsWith("*")) {
        removed += 1;
        return false;
      }
      const isLast = lastIndex.get(key) === i;
      if (!isLast) removed += 1;
      return isLast;
    });
    return `{${kept.join(";")}}`;
  });
  return { out, removed };
}

const [current, deployed] = await Promise.all([
  readFile(TARGET, "utf8"),
  fetchDeployed(),
]);
const { fonts, additions } = extractParts(current);
const { out: deduped, removed } = dedupProperties(deployed.replace(/\s+$/, ""));

const header = `/* inscriptum export stylesheet — GENERATED by scripts/generate-note-css.mjs; do not edit.
 * Self-contained: fonts are embedded as data URIs (reused from the previous
 * build; see README for the font re-inline procedure). Part 2 is the deployed
 * inscriptum note.css with duplicate declarations removed (keep-last).
 * Regenerate: node scripts/generate-note-css.mjs */
/* stylelint-disable plugin/no-unsupported-browser-features -- the deployed site stylesheet intentionally targets more browsers than Obsidian's Chromium: text-decoration styling, display:contents and multicolumn are load-bearing design there, and the exported pages are viewed outside Obsidian. */

`;

const result = `${header}${fonts}\n${deduped}\n\n${additions}`;
await writeFile(TARGET, result);
console.log(
  `note.css regenerated: ${removed} duplicate declaration(s) removed, ` +
    `${deduped.length} chars of deployed css`,
);
