// Pure helpers for scripts/generate-note-css.mjs (the CLI). Kept separate
// from the CLI so they can be unit-tested (see
// tests/generate-note-css/generate-note-css.test.ts) — the CLI itself reads
// the vault-facing file, fetches the deployed stylesheet and writes the
// result, none of which a test wants to run.

/**
 * Fails fast on CSS the block splitter below cannot see through:
 *  - an unbalanced quote (the closing quote is missing),
 *  - a brace inside a quoted value (the block regex would cut the block
 *    at that brace and mangle the rule).
 * The maintainer then fixes the upstream change by hand — the generator
 * must never write silently broken CSS.
 */
export function assertSplittable(css) {
  for (let i = 0; i < css.length; i += 1) {
    const ch = css[i];
    if (ch !== '"' && ch !== "'") continue;
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

/**
 * Splits a declaration block on the `;` boundaries that are NOT inside a
 * quoted string. CSS values may contain semicolons (`content:"a;b"`, and
 * `content` is a plain value), so a naive split cuts the value in half and
 * the rewritten file loses a fragment of it.
 */
export function splitDeclarations(inner) {
  const out = [];
  let current = "";
  let quote = null;
  for (let i = 0; i < inner.length; i += 1) {
    const ch = inner[i];
    if (quote != null) {
      current += ch;
      if (ch === "\\") {
        // escaped character — copy it and the next one verbatim
        if (i + 1 < inner.length) {
          current += inner[i + 1];
          i += 1;
        }
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === ";") {
      out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (quote != null) throw new Error("unbalanced quote in deployed css");
  out.push(current);
  return out;
}

/**
 * Removes duplicate property declarations inside each block, keeping the
 * LAST occurrence (cascade-equivalent: the last declaration wins — an
 * `!important` repeat only loses to a later `!important` of the same
 * property, so importance is part of the dedup key), and drops legacy IE
 * star-hack declarations (*prop — invalid in every modern browser and
 * flagged as duplicates by the stylelint gate).
 *
 * Conservative guards: a block containing `url(` is left untouched (a `;`
 * inside an unquoted data URI would break naive splitting), and the whole
 * run fails when quotes and braces interleave in a way the splitter cannot
 * see through.
 */
export function dedupProperties(css) {
  assertSplittable(css);
  let removed = 0;
  const out = css.replace(/\{[^{}]*\}/g, (block) => {
    if (block.includes("url(")) return block;
    const inner = block.slice(1, -1);
    const decls = splitDeclarations(inner);
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

/**
 * Rewrites the browser-feature usages the review bot's CSS lint flags on
 * any Chromium (stylelint-disable comments are not honored by the bot):
 *
 *  - the normalize.css dotted underline for `abbr[title]` is dropped —
 *    every browser the site targets draws it from the UA stylesheet, so
 *    the declaration is redundant;
 *  - `display:contents` becomes `display:block` in the two rules that use
 *    it (taskList row wrapper, figure wrapper) — both are plain block-flow
 *    spots where a block wrapper is layout-equivalent, and the progress bar
 *    inside the figure wrapper anchors to the wrapper's position:relative,
 *    which display:contents silently discarded;
 *  - any `column-gap` declaration becomes `gap: 0 <value>` (multicolumn is
 *    flagged). Pinning row-gap to 0 keeps the rewrite cascade-equivalent
 *    even where the block stacks children into several grid rows (the
 *    title-page property rows): plain `gap: <value>` would introduce a
 *    row-gap the old `column-gap` never set. Blocks with `url(` (data
 *    URIs the splitter cannot see through) or their own `row-gap` are
 *    left untouched — the latter would be clobbered by the shorthand.
 *
 * Each pattern is applied only when present and the replacement count is
 * reported, so regeneration from an upstream that already fixed itself is
 * a no-op, and an upstream redesign shows up in the caller's output. The
 * generator pairs this with `assertNoFlaggedFeatures` so a drifted
 * upstream fails loudly instead of quietly reintroducing lint warnings.
 */
export function stripFlaggedFeatures(css) {
  const patterns = [
    [
      "abbr[title]{border-bottom:none;text-decoration:underline dotted}",
      "abbr[title]{border-bottom:none}",
    ],
    [
      "article ul[data-type=taskList] li>div{display:contents}",
      "article ul[data-type=taskList] li>div{display:block}",
    ],
    [
      "article .figure_wrapper{position:relative;display:contents}",
      "article .figure_wrapper{position:relative;display:block}",
    ],
  ];
  const replaced = [];
  let out = css;
  for (const [from, to] of patterns) {
    while (out.includes(from)) {
      out = out.replace(from, to);
      replaced.push(from);
    }
  }
  out = out.replace(/\{[^{}]*\}/g, (block) => {
    // Same conservative guards as dedupProperties: url( values may hide
    // `;`/braces, and a block managing its own row-gap must not be
    // rewritten through the shorthand that would reset it.
    if (block.includes("url(") || /(^|[;{])\s*row-gap\s*:/.test(block)) {
      return block;
    }
    if (!block.includes("column-gap:")) return block;
    const inner = block.slice(1, -1);
    const decls = splitDeclarations(inner);
    const rewritten = [];
    for (const d of decls) {
      const match = d.match(/^\s*column-gap\s*:\s*([^;]+)$/);
      if (match) {
        rewritten.push(`gap:0 ${match[1].trim()}`);
        replaced.push(d.trim());
      } else {
        rewritten.push(d);
      }
    }
    return `{${rewritten.join(";")}}`;
  });
  return { out, replaced };
}

/**
 * Fails when the finished stylesheet still contains a construction the
 * review bot's CSS lint flags (text-decoration-* longhands, the two-value
 * shorthand is fine, display:contents, column-gap). Regeneration must
 * never quietly ship lint warnings back into the generated file.
 */
export function assertNoFlaggedFeatures(css) {
  const checks = [
    [
      /text-decoration-(?:color|thickness|style|line)\s*:/,
      "text-decoration-* longhand",
    ],
    [/display:\s*contents/, "display: contents"],
    [/column-gap\s*:/, "column-gap"],
  ];
  const offenders = [];
  for (const [re, label] of checks) {
    const match = css.match(re);
    if (match) offenders.push(`${label} (${match[0]})`);
  }
  if (offenders.length > 0) {
    throw new Error(
      "generated note.css still contains review-bot-flagged CSS — " +
        "extend stripFlaggedFeatures or fix the upstream: " +
        offenders.join("; "),
    );
  }
}
