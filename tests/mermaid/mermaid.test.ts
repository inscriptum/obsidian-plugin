import { describe, expect, it } from "vitest";
import {
  DOMParser as PMDOMParser,
  DOMSerializer,
} from "prosemirror-model";

import { buildSchema } from "../helpers/buildSchema";
import { roundTrip } from "../helpers/roundTrip";
import { getProfileSchema } from "../../src/texto/editorSchemas";
import {
  DEFAULT_MERMAID_SOURCE,
  addCommands,
} from "../../src/texto/extensions/mermaid/commands";
import { HTML_TAG } from "../../src/texto/extensions/mermaid/mermaid";
import { parseSvgElement } from "../../src/texto/extensions/mermaid/mermaidApi";

const DOC_WITH_MERMAID = {
  type: "noteDoc",
  content: [
    { type: "noteTitle", content: [{ type: "text", text: "Title" }] },
    { type: "paragraph", content: [{ type: "text", text: "before" }] },
    { type: "mermaid", attrs: { code: "flowchart TD\n  A-->B" } },
    { type: "paragraph", content: [{ type: "text", text: "after" }] },
  ],
};

describe("mermaid node", () => {
  const schema = buildSchema();

  it("exists in the schema as an atom block", () => {
    const nodeType = schema.nodes["mermaid"];
    expect(nodeType).toBeDefined();
    expect(nodeType?.isAtom).toBe(true);
    expect(nodeType?.isInGroup("block")).toBe(true);
  });

  it("admits the node as a top-level child in the note profile", () => {
    const doc = schema.nodeFromJSON(DOC_WITH_MERMAID);
    expect(() => doc.check()).not.toThrow();
  });

  it("admits the node in the title and plain profiles", () => {
    // The title profile requires noteSummary after noteTitle.
    const titleDoc = {
      ...DOC_WITH_MERMAID,
      content: [
        DOC_WITH_MERMAID.content[0],
        {
          type: "noteSummary",
          content: [{ type: "text", text: "Summary" }],
        },
        ...DOC_WITH_MERMAID.content.slice(1),
      ],
    };
    const title = getProfileSchema("title").nodeFromJSON(titleDoc);
    expect(() => title.check()).not.toThrow();

    const plain = getProfileSchema("plain").nodeFromJSON(DOC_WITH_MERMAID);
    expect(() => plain.check()).not.toThrow();
  });

  it("round-trips the source through JSON (storage compat)", () => {
    const json = roundTrip(DOC_WITH_MERMAID);
    const mermaidNode = json.content?.find((n) => n.type === "mermaid");
    expect(mermaidNode?.attrs?.["code"]).toBe("flowchart TD\n  A-->B");
  });

  it("parses back from its static HTML tag (clipboard compat)", () => {
    const el = document.createElement(HTML_TAG);
    el.dataset["code"] = "graph TD\n  A-->B";
    // The parser reads the CONTENT of the given node (as the clipboard does),
    // so the serialized block arrives wrapped. The noteDoc context needs its
    // required noteTitle before any block, hence the h1.
    const wrapper = document.createElement("div");
    wrapper.appendChild(document.createElement("h1"));
    wrapper.appendChild(el);
    const doc = PMDOMParser.fromSchema(schema).parse(wrapper);
    let found: { code: unknown } | null = null;
    doc.descendants((n) => {
      if (n.type.name === "mermaid") {
        found = { code: n.attrs["code"] };
        return false;
      }
      return true;
    });
    expect(found).toEqual({ code: "graph TD\n  A-->B" });
  });

  it("serializes to the static HTML tag with data-code", () => {
    const node = schema.nodes["mermaid"].create({
      code: DEFAULT_MERMAID_SOURCE,
    });
    const dom = DOMSerializer.fromSchema(schema).serializeNode(node);
    const el = (dom as HTMLElement).querySelector?.(HTML_TAG) ?? (dom as HTMLElement);
    expect(el.tagName.toLowerCase()).toBe(HTML_TAG);
    expect(el.getAttribute("data-code")).toBe(DEFAULT_MERMAID_SOURCE);
  });

  it("defaults to an empty source and left align", () => {
    const node = schema.nodes["mermaid"].create();
    expect(node.attrs["code"]).toBe("");
    expect(node.attrs["align"]).toBe("left");
  });

  it("parses data-align from its static HTML tag", () => {
    const wrapper = document.createElement("div");
    wrapper.appendChild(document.createElement("h1"));
    const el = document.createElement(HTML_TAG);
    el.dataset["code"] = "graph TD";
    el.dataset["align"] = "center";
    wrapper.appendChild(el);
    const doc = PMDOMParser.fromSchema(schema).parse(wrapper);
    let align: unknown = null;
    doc.descendants((n) => {
      if (n.type.name === "mermaid") {
        align = n.attrs["align"];
        return false;
      }
      return true;
    });
    expect(align).toBe("center");
  });

  it("parseSvgElement accepts well-formed SVG and rejects everything else", () => {
    const ok = parseSvgElement(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2 2"><path d="M0 0"/></svg>',
    );
    expect(ok?.nodeName.toLowerCase()).toBe("svg");
    expect(parseSvgElement("<div>not svg</div>")).toBeNull();
    expect(parseSvgElement("<<definitely not xml")).toBeNull();
  });

  it("insertMermaid inserts a block with the example source", () => {
    // Command shape check without a full editor: the bound command builds
    // an insertContent step against this.name.
    const fakeThis = {
      name: "mermaid",
    } as unknown as ThisParameterType<typeof addCommands>;
    const command = addCommands.call(fakeThis).insertMermaid();
    const commandsMock = {
      insertContent: (json: unknown) => {
        expect(json).toEqual({
          type: "mermaid",
          attrs: { code: DEFAULT_MERMAID_SOURCE },
        });
        return true;
      },
    };
    expect(command({ commands: commandsMock } as never)).toBe(true);
  });
});
