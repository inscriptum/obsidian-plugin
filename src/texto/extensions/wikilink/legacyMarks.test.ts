import { describe, it, expect } from "vitest";
import {
  hasLegacyWikiSyntax,
  convertLegacyWikiSyntax,
} from "./legacyMarks";
import type { JSONContent } from "../../core/@types";

const marked = (text: string, path: string): JSONContent => ({
  type: "text",
  text,
  marks: [{ type: "wikiLink", attrs: { path } }],
});

const node = (label: string, path: string): JSONContent => ({
  type: "wikiLink",
  attrs: { path, text: label },
});

describe("legacy wikilink generations → atom node", () => {
  it("detects raw patterns anywhere in the doc", () => {
    const doc: JSONContent = {
      type: "noteDoc",
      content: [
        { type: "noteTitle", content: [{ type: "text", text: "T" }] },
        {
          type: "paragraph",
          content: [{ type: "text", text: "see [[notes/plan.um]] here" }],
        },
      ],
    };
    expect(hasLegacyWikiSyntax(doc)).toBe(true);
    expect(hasLegacyWikiSyntax({ type: "noteDoc", content: [] })).toBe(false);
  });

  it("does not flag atom nodes, committed marks or plain text", () => {
    expect(hasLegacyWikiSyntax({
      type: "paragraph",
      content: [node("plan", "notes/plan.um")],
    })).toBe(false);
    expect(hasLegacyWikiSyntax({
      type: "paragraph",
      content: [marked("plan", "notes/plan.um")],
    })).toBe(true);
    expect(hasLegacyWikiSyntax({
      type: "paragraph",
      content: [{ type: "text", text: "plain [x] and [[unclosed" }],
    })).toBe(false);
  });

  it("converts a raw pattern into the atom node, splitting the text node", () => {
    const doc: JSONContent = {
      type: "noteDoc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "see [[notes/planning.um|planning]] now" },
          ],
        },
      ],
    };
    const out = convertLegacyWikiSyntax(doc);
    const para = (out.content?.[0] as JSONContent).content as JSONContent[];
    expect(para).toHaveLength(3);
    expect(para[0]).toEqual({ type: "text", text: "see " });
    expect(para[1]).toEqual({
      type: "wikiLink",
      attrs: { path: "notes/planning.um", text: "planning" },
    });
    expect(para[2]).toEqual({ type: "text", text: " now" });
  });

  it("a pattern without a label uses the target as the label", () => {
    const doc: JSONContent = {
      type: "paragraph",
      content: [{ type: "text", text: "[[p.md]]" }],
    };
    const out = convertLegacyWikiSyntax(doc);
    expect(out.content?.[0]).toEqual(node("p.md", "p.md"));
  });

  it("an empty display («[[path|]]») falls back to the target", () => {
    const doc: JSONContent = {
      type: "paragraph",
      content: [{ type: "text", text: "[[p.md|]]" }],
    };
    const out = convertLegacyWikiSyntax(doc);
    expect(out.content?.[0]).toEqual(node("p.md", "p.md"));
  });

  it("keeps non-wiki marks on the surrounding runs", () => {
    const doc: JSONContent = {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "a [[p.md|x]] b",
          marks: [{ type: "bold" }],
        },
      ],
    };
    const out = convertLegacyWikiSyntax(doc);
    const para = out.content as JSONContent[];
    expect(para[0]).toEqual({
      type: "text",
      text: "a ",
      marks: [{ type: "bold" }],
    });
    expect(para[1]).toEqual(node("x", "p.md"));
    expect(para[2]!.marks).toEqual([{ type: "bold" }]);
  });

  it("converts wikiLink-marked runs (rounds 1–2 / mark builds) to the atom", () => {
    const doc: JSONContent = {
      type: "paragraph",
      content: [marked("planning", "notes/planning.um")],
    };
    expect(hasLegacyWikiSyntax(doc)).toBe(true);
    const out = convertLegacyWikiSyntax(doc);
    expect(out.content?.[0]).toEqual(node("planning", "notes/planning.um"));
  });

  it("leaves incomplete patterns literal", () => {
    const doc: JSONContent = {
      type: "paragraph",
      content: [
        { type: "text", text: "[[unclosed and []] empty and [x] single" },
      ],
    };
    expect(convertLegacyWikiSyntax(doc)).toEqual(doc);
  });

  it("keeps raw syntax inside code blocks and inline code", () => {
    const doc: JSONContent = {
      type: "noteDoc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "[[live.md]] " },
            {
              type: "text",
              text: "[[quoted.md]]",
              marks: [{ type: "code" }],
            },
          ],
        },
        {
          type: "hljsCodeBlock",
          content: [
            {
              type: "hljsCodeBlockRow",
              content: [{ type: "text", text: "[[incode.md]]" }],
            },
          ],
        },
      ],
    };
    expect(hasLegacyWikiSyntax(doc)).toBe(true);
    const out = convertLegacyWikiSyntax(doc);
    const para = (out.content?.[0] as JSONContent).content as JSONContent[];
    expect(para[0]).toEqual(node("live.md", "live.md"));
    expect(para[1]!.text).toBe(" ");
    expect(para[2]!.text).toBe("[[quoted.md]]");
    expect(para[2]!.marks).toEqual([{ type: "code" }]);
    const row = ((out.content?.[1] as JSONContent)
      .content as JSONContent[])[0]!;
    expect(row.content).toEqual([{ type: "text", text: "[[incode.md]]" }]);
  });

  it("is idempotent", () => {
    const doc: JSONContent = {
      type: "paragraph",
      content: [{ type: "text", text: "see [[a.md|a]] now" }],
    };
    const once = convertLegacyWikiSyntax(doc);
    expect(convertLegacyWikiSyntax(once)).toEqual(once);
  });
});
