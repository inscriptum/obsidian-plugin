import { describe, expect, it } from "vitest";
import { DOMParser as PMDOMParser, DOMSerializer } from "prosemirror-model";

import { buildSchema } from "../helpers/buildSchema";
import { roundTrip } from "../helpers/roundTrip";
import { HTML_TAG } from "../../src/texto/extensions/attachment/attachment";

const DOC_WITH_ATTACHMENT = {
  type: "noteDoc",
  content: [
    { type: "noteTitle", content: [{ type: "text", text: "Title" }] },
    { type: "paragraph", content: [{ type: "text", text: "before" }] },
    {
      type: "attachment",
      attrs: {
        data: {
          id: "docs/report.pdf",
          size: "2048",
          filename: "report.pdf",
        },
      },
    },
    { type: "paragraph", content: [{ type: "text", text: "after" }] },
  ],
};

const DOC_WITH_EXTERNAL_ATTACHMENT = {
  ...DOC_WITH_ATTACHMENT,
  content: [
    DOC_WITH_ATTACHMENT.content[0],
    DOC_WITH_ATTACHMENT.content[1],
    {
      type: "attachment",
      attrs: {
        data: {
          id: "/outside/report.pdf",
          size: "2048",
          filename: "report.pdf",
          mode: "external",
        },
      },
    },
    DOC_WITH_ATTACHMENT.content[3],
  ],
};

describe("attachment node", () => {
  const schema = buildSchema();

  it("round-trips an in-vault link through JSON without a mode", () => {
    const json = roundTrip(DOC_WITH_ATTACHMENT);
    const node = json.content?.find((n) => n.type === "attachment");
    expect(node?.attrs?.["data"]).toEqual({
      id: "docs/report.pdf",
      size: "2048",
      filename: "report.pdf",
    });
  });

  it("round-trips data-mode through JSON (storage compat)", () => {
    const json = roundTrip(DOC_WITH_EXTERNAL_ATTACHMENT);
    const node = json.content?.find((n) => n.type === "attachment");
    expect(node?.attrs?.["data"]).toEqual({
      id: "/outside/report.pdf",
      size: "2048",
      filename: "report.pdf",
      mode: "external",
    });
  });

  it("serializes an external link with data-mode", () => {
    const node = schema.nodes["attachment"].create({
      data: { id: "/outside/report.pdf", filename: "report.pdf", mode: "external" },
    });
    const dom = DOMSerializer.fromSchema(schema).serializeNode(node);
    const el = (dom as HTMLElement).querySelector?.(HTML_TAG) ?? (dom as HTMLElement);
    expect(el.getAttribute("data-id")).toBe("/outside/report.pdf");
    expect(el.getAttribute("data-mode")).toBe("external");
  });

  it("serializes an in-vault link without data-mode", () => {
    const node = schema.nodes["attachment"].create({
      data: { id: "docs/report.pdf", filename: "report.pdf" },
    });
    const dom = DOMSerializer.fromSchema(schema).serializeNode(node);
    const el = (dom as HTMLElement).querySelector?.(HTML_TAG) ?? (dom as HTMLElement);
    expect(el.getAttribute("data-mode")).toBeNull();
  });

  it("parses data-mode back from the static HTML tag (clipboard compat)", () => {
    const wrapper = document.createElement("div");
    wrapper.appendChild(document.createElement("h1"));
    const el = document.createElement(HTML_TAG);
    el.dataset["id"] = "/outside/report.pdf";
    el.dataset["filename"] = "report.pdf";
    el.dataset["mode"] = "external";
    wrapper.appendChild(el);

    const doc = PMDOMParser.fromSchema(schema).parse(wrapper);
    let found: { id: unknown; mode: unknown } | null = null;
    doc.descendants((n) => {
      if (n.type.name === "attachment") {
        const data = n.attrs["data"] as { id?: string; mode?: string };
        found = { id: data.id, mode: data.mode };
        return false;
      }
      return true;
    });
    expect(found).toEqual({ id: "/outside/report.pdf", mode: "external" });
  });

  it("parses an old attachment without data-mode as an in-vault link", () => {
    const wrapper = document.createElement("div");
    wrapper.appendChild(document.createElement("h1"));
    const el = document.createElement(HTML_TAG);
    el.dataset["id"] = "docs/report.pdf";
    wrapper.appendChild(el);

    const doc = PMDOMParser.fromSchema(schema).parse(wrapper);
    let mode: unknown = "unset";
    doc.descendants((n) => {
      if (n.type.name === "attachment") {
        mode = (n.attrs["data"] as { mode?: string }).mode;
        return false;
      }
      return true;
    });
    expect(mode).toBeUndefined();
  });
});
