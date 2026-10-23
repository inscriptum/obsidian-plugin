import { describe, expect, it } from "vitest";

import {
  hasCellColorAttrQuirk,
  normalizeCellColorAttrsJSON,
} from "./cellColorAttrs";

type Json = Record<string, unknown>;

const cell = (attrs: Json, text = "x"): Json => ({
  type: "tableCell",
  attrs,
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

const doc = (cells: Json[]): Json => ({
  type: "noteDoc",
  content: [
    {
      type: "table",
      content: cells.map((c) => ({ type: "tableRow", content: [c] })),
    },
  ],
});

describe("hasCellColorAttrQuirk", () => {
  it("detects the clipboard-parse array in dataColor", () => {
    expect(hasCellColorAttrQuirk(doc([cell({ dataColor: [] })]))).toBe(true);
  });

  it("detects a non-string backgroundColor", () => {
    expect(hasCellColorAttrQuirk(doc([cell({ backgroundColor: 5 })]))).toBe(true);
  });

  it("accepts strings, null and absent attrs", () => {
    expect(
      hasCellColorAttrQuirk(
        doc([cell({ dataColor: "#ff0000", backgroundColor: null })]),
      ),
    ).toBe(false);
    expect(hasCellColorAttrQuirk(doc([cell({})]))).toBe(false);
  });
});

describe("normalizeCellColorAttrsJSON", () => {
  it("nulls the broken attrs and keeps well-formed colors", () => {
    const document = doc([
      cell({ dataColor: [], backgroundColor: "#00ff00", colwidth: [50] }),
      cell({ dataColor: "#112233" }),
    ]);
    normalizeCellColorAttrsJSON(document as never);
    // doc() gives every cell its own row
    const rows = (((document.content as Json[])[0].content ?? []) as Json[]);
    const cellAt = (row: number) =>
      (((rows[row].content ?? []) as Json[])[0].attrs ?? {}) as Json;
    expect(cellAt(0).dataColor).toBeNull();
    expect(cellAt(0).backgroundColor).toBe("#00ff00");
    expect(cellAt(0).colwidth).toEqual([50]);
    expect(cellAt(1).dataColor).toBe("#112233");
  });

  it("leaves documents without the quirk untouched (in place, no throw)", () => {
    const document = doc([cell({ dataColor: "#112233" })]);
    expect(() => normalizeCellColorAttrsJSON(document as never)).not.toThrow();
    const table = (document.content as Json[])[0];
    expect(Array.isArray(table.content)).toBe(true);
  });
});
