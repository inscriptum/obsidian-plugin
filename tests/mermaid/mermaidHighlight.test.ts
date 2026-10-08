import { describe, expect, it } from "vitest";
import { highlightMermaidLines } from "../../src/texto/extensions/mermaid/mermaidHighlight";

const classesOf = (html: string) =>
  [...html.matchAll(/class="(hljs-[^"]*)"/g)].map((m) => m[1]);

describe("highlightMermaidLines", () => {
  it("highlights keywords and strings", () => {
    const [first] = highlightMermaidLines(['flowchart LR', '  A["text"] --> B']);
    expect(first).toContain('class="hljs-keyword"');
    expect(classesOf(highlightMermaidLines(['  A["text"]'])[0])).toContain("hljs-string");
  });

  it("never leaks raw markup — the source stays escaped in output", () => {
    const html = highlightMermaidLines(["<b> & </b>"])[0];
    // raw angle brackets from the source must never appear unescaped
    expect(html).not.toMatch(/<b>/);
    expect(html).toContain("&amp;");
  });

  it("highlights frontmatter lines as yaml", () => {
    const out = highlightMermaidLines([
      "---",
      "title: My diagram",
      "config:",
      "  theme: dark",
      "---",
      "flowchart LR",
      "  A --> B",
    ]);
    // the fence lines
    expect(out[0]).toContain("hljs-meta");
    // the key/value lines inside the fence are highlighted with yaml classes
    expect(classesOf(out[1])).toContain("hljs-attr");
    expect(classesOf(out[4])).toContain("hljs-meta");
    // the diagram body after the fence uses the mermaid grammar
    expect(classesOf(out[5])).toContain("hljs-keyword");
  });

  it("directives are meta, not comments; bare numbers are numbers, not titles", () => {
    const out = highlightMermaidLines([
      "%%{init: {'theme': 'dark'}}%%",
      "%% a plain comment",
      "flowchart TD",
      "  A --> 123",
    ]);
    // the directive is meta (the comment rule must not swallow it)
    expect(classesOf(out[0])).toContain("hljs-meta");
    expect(classesOf(out[0])).not.toContain("hljs-comment");
    // plain %% comments are still comments
    expect(classesOf(out[1])).toContain("hljs-comment");
    // node ids are titles, but bare digit runs are numbers
    expect(classesOf(out[3])).toContain("hljs-number");
    expect(classesOf(highlightMermaidLines(["123"])[0])).toEqual(["hljs-number"]);
  });
});
