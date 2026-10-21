import { describe, it, expect } from "vitest";
import {
  assertSplittable,
  dedupProperties,
  splitDeclarations,
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
