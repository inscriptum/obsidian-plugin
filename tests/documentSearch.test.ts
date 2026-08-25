import { describe, expect, it } from "vitest";
import { schema } from "prosemirror-schema-basic";
import { findDocumentMatches } from "../src/search/documentSearch";

describe("findDocumentMatches", () => {
  it("finds case-insensitive matches and returns document positions", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, schema.text("Hello world, hello!")),
    ]);

    expect(findDocumentMatches(doc, "HELLO")).toEqual([
      { from: 1, to: 6 },
      { from: 14, to: 19 },
    ]);
  });

  it("does not search when the query is empty", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, schema.text("Text")),
    ]);

    expect(findDocumentMatches(doc, "")).toEqual([]);
  });

  it("finds a match across adjacent formatted text nodes", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [
        schema.text("Hello "),
        schema.text("world", [schema.marks.strong.create()]),
      ]),
    ]);

    expect(findDocumentMatches(doc, "Hello world")).toEqual([
      { from: 1, to: 12 },
    ]);
  });
});
