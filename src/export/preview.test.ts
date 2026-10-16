import { describe, expect, it } from "vitest";
import { extractPreview } from "./preview";
import type { JSONContent } from "../texto/core/@types";

function titlePage(children: JSONContent[]): JSONContent {
  return {
    type: "noteDoc",
    content: [
      { type: "noteTitle", content: [{ type: "text", text: "Cover" }] },
      ...children,
    ],
  };
}

function property(name: string, values: string[]): JSONContent {
  return {
    type: "noteProperty",
    attrs: { type: values.length > 1 ? "list" : "text" },
    content: [
      {
        type: "notePropertyName",
        content: [{ type: "text", text: name }],
      },
      ...values.map((value) => ({
        type: "notePropertyValue",
        content: [{ type: "text", text: value }],
      })),
    ],
  };
}

describe("extractPreview", () => {
  it("reads the meta description from the description property (title v3)", () => {
    const doc = titlePage([
      property("description", ["What this notepad is about."]),
      { type: "paragraph", content: [{ type: "text", text: "First paragraph." }] },
    ]);
    expect(extractPreview(doc).description).toBe(
      "What this notepad is about.",
    );
  });

  it("recognizes any casing of the description property name", () => {
    const doc = titlePage([
      property("Description", ["Hand-typed capitalized name."]),
      { type: "paragraph", content: [{ type: "text", text: "First paragraph." }] },
    ]);
    expect(extractPreview(doc).description).toBe("Hand-typed capitalized name.");
  });

  it("joins the values of a List-typed description property", () => {
    const doc = titlePage([
      property("description", ["one", "two"]),
      { type: "paragraph" },
    ]);
    expect(extractPreview(doc).description).toBe("one, two");
  });

  it("ignores other properties and falls back to the first paragraph", () => {
    const doc = titlePage([
      property("tags", ["meta"]),
      property("status", ["draft"]),
      {
        type: "paragraph",
        content: [{ type: "text", text: "First paragraph text." }],
      },
    ]);
    expect(extractPreview(doc).description).toBe("First paragraph text.");
  });

  it("falls back to the legacy noteSummary line (pre-v3 title pages)", () => {
    const doc = titlePage([
      { type: "noteSummary", content: [{ type: "text", text: "Old summary." }] },
      { type: "paragraph" },
    ]);
    expect(extractPreview(doc).description).toBe("Old summary.");
  });

  it("truncates a long description with an ellipsis", () => {
    const long = "x".repeat(300);
    const doc = titlePage([property("description", [long])]);
    const { description } = extractPreview(doc);
    expect(description.length).toBeLessThanOrEqual(200);
    expect(description.endsWith("…")).toBe(true);
  });

  it("keeps the title from the noteTitle node and the first image as preview", () => {
    const doc = titlePage([
      property("description", ["d"]),
      {
        type: "paragraph",
        content: [
          { type: "text", text: "before " },
          {
            type: "image",
            attrs: { data: { id: "asset-9", size: "1", filename: "p.png" } },
          },
        ],
      },
    ]);
    const preview = extractPreview(doc);
    expect(preview.title).toBe("Cover");
    expect(preview.previewImageId).toBe("asset-9");
  });
});
