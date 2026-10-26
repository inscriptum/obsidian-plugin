import { describe, it, expect } from "vitest";
import {
  hasLegacyWikiMarks,
  convertLegacyWikiMarks,
} from "./legacyMarks";
import type { JSONContent } from "../../core/@types";

const marked = (text: string, path: string): JSONContent => ({
  type: "text",
  text,
  marks: [{ type: "wikiLink", attrs: { path } }],
});

describe("legacy wikiLink marks → inline syntax", () => {
  it("detects marks anywhere in the doc", () => {
    const doc: JSONContent = {
      type: "noteDoc",
      content: [
        { type: "noteTitle", content: [{ type: "text", text: "T" }] },
        {
          type: "paragraph",
          content: [{ type: "text", text: "plain" }],
        },
        {
          type: "paragraph",
          content: [marked("planning", "notes/planning.um")],
        },
      ],
    };
    expect(hasLegacyWikiMarks(doc)).toBe(true);
    expect(hasLegacyWikiMarks({ type: "noteDoc", content: [] })).toBe(false);
  });

  it("converts a marked run to «[[path|text]]» plain text", () => {
    const doc: JSONContent = {
      type: "noteDoc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "see " },
            marked("planning", "notes/planning.um"),
          ],
        },
      ],
    };
    const out = convertLegacyWikiMarks(doc);
    const para = (out.content?.[0] as JSONContent).content as JSONContent[];
    // runs stay separate (no merging) — the marked one becomes the syntax
    expect(para).toHaveLength(2);
    expect(para[0]!.text).toBe("see ");
    expect(para[1]!.text).toBe("[[notes/planning.um|planning]]");
    expect(para[1]!.marks).toBeUndefined();
  });

  it("keeps non-wiki marks on the run", () => {
    const doc: JSONContent = {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "x",
          marks: [
            { type: "bold" },
            { type: "wikiLink", attrs: { path: "p.md" } },
          ],
        },
      ],
    };
    const out = convertLegacyWikiMarks(doc);
    const run = out.content?.[0] as JSONContent;
    expect(run.marks).toEqual([{ type: "bold" }]);
    expect(run.text).toBe("[[p.md|x]]");
  });

  it("drops a mark with an empty path but keeps the text", () => {
    const doc: JSONContent = {
      type: "paragraph",
      content: [marked("bare", "")],
    };
    const out = convertLegacyWikiMarks(doc);
    const run = out.content?.[0] as JSONContent;
    expect(run.marks).toBeUndefined();
    expect(run.text).toBe("bare");
  });
});
