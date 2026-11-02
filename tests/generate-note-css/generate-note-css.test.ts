import { describe, it, expect } from "vitest";
import {
  assertSplittable,
  dedupProperties,
  splitDeclarations,
  stripFlaggedFeatures,
} from "../../scripts/generate-note-css-lib.mjs";

describe("splitDeclarations", () => {
  it("splits on top-level semicolons", () => {
    expect(splitDeclarations("color:red;background:blue")).toEqual([
      "color:red",
      "background:blue",
    ]);
  });

  it("keeps a semicolon inside a double-quoted value", () => {
    expect(splitDeclarations('content:"x;color:red";color:blue')).toEqual([
      'content:"x;color:red"',
      "color:blue",
    ]);
  });

  it("keeps a semicolon inside a single-quoted value", () => {
    expect(splitDeclarations("content:'a;b'")).toEqual(["content:'a;b'"]);
  });

  it("keeps an escaped quote inside a value", () => {
    expect(splitDeclarations('content:"a\\"b;c"')).toEqual([
      'content:"a\\"b;c"',
    ]);
  });

  it("throws on an unbalanced quote", () => {
    expect(() => splitDeclarations('content:"a;b')).toThrow(/unbalanced quote/);
  });
});

describe("assertSplittable", () => {
  it("passes on plain css", () => {
    expect(() => assertSplittable('.a{content:"x;y"}')).not.toThrow();
  });

  it("throws on an unbalanced quote", () => {
    expect(() => assertSplittable('.a{content:"x}')).toThrow(
      /unbalanced quote/,
    );
  });

  it("throws on a brace inside a quoted value", () => {
    expect(() => assertSplittable('.a{content:"{x}"}')).toThrow(/brace inside/);
  });
});

describe("dedupProperties", () => {
  it("keeps the last occurrence of a duplicated property", () => {
    const { out, removed } = dedupProperties(".a{color:red;color:blue}");
    expect(out).toBe(".a{color:blue}");
    expect(removed).toBe(1);
  });

  it("treats an important declaration as a different property", () => {
    const { out } = dedupProperties(".a{color:red !important;color:blue}");
    expect(out).toBe(".a{color:red !important;color:blue}");
  });

  it("drops legacy star-hack declarations", () => {
    const { out, removed } = dedupProperties(".a{*width:100%;width:50%}");
    expect(out).toBe(".a{width:50%}");
    expect(removed).toBe(1);
  });

  it("leaves blocks with url() untouched", () => {
    const css = ".a{background:url(data:image/png;base64,AAA);background:red}";
    const { out } = dedupProperties(css);
    expect(out).toBe(css);
  });

  // Regression (PR review): a semicolon inside a quoted value used to be
  // treated as a declaration boundary — the value was cut in half and the
  // generated stylesheet lost a fragment of it.
  it("keeps a quoted value that contains a semicolon", () => {
    const { out } = dedupProperties('.x{content:"x;color:red";color:blue}');
    expect(out).toBe('.x{content:"x;color:red";color:blue}');
  });

  it("keeps a quoted value that contains a semicolon next to a duplicate", () => {
    const { out } = dedupProperties('.x{content:"a;b";color:red;color:blue}');
    expect(out).toBe('.x{content:"a;b";color:blue}');
  });
});

describe("stripFlaggedFeatures", () => {
  const abbr = "abbr[title]{border-bottom:none;text-decoration:underline dotted}";
  const taskList = "article ul[data-type=taskList] li>div{display:contents}";
  const figureWrapper = "article .figure_wrapper{position:relative;display:contents}";

  it("drops the normalize dotted underline for abbr[title]", () => {
    const { out, replaced } = stripFlaggedFeatures(`x{a:b}${abbr}`);
    expect(out).toBe("x{a:b}abbr[title]{border-bottom:none}");
    expect(replaced).toHaveLength(1);
  });

  it("rewrites display:contents to display:block in both rules", () => {
    const { out, replaced } = stripFlaggedFeatures(`${taskList}${figureWrapper}`);
    expect(out).toBe(
      "article ul[data-type=taskList] li>div{display:block}" +
        "article .figure_wrapper{position:relative;display:block}",
    );
    expect(replaced).toHaveLength(2);
  });

  it("rewrites every column-gap to gap", () => {
    const { out, replaced } = stripFlaggedFeatures("a{column-gap:14px}b{column-gap:1rem}");
    expect(out).toBe("a{gap:14px}b{gap:1rem}");
    expect(replaced).toHaveLength(2);
  });

  it("is a no-op on css that has no flagged usages", () => {
    const css = "a{gap:14px}abbr[title]{border-bottom:none}";
    const { out, replaced } = stripFlaggedFeatures(css);
    expect(out).toBe(css);
    expect(replaced).toHaveLength(0);
  });
});
