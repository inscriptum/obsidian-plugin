import { afterAll, describe, it, expect } from "vitest";
import { DOMParser } from "prosemirror-model";
import { Editor } from "../../src/texto/core/Editor";
import { getExtensions } from "../../src/texto/getExtensions";
import type { JSONContent } from "../../src/texto/core/@types";
import { parseNoteDoc } from "../../src/storage/noteStorage";
import { buildSchema } from "../helpers/buildSchema";
import { ensureCellTrailingParagraphJSON } from "../../src/texto/extensions/table/helpers/cellTrailingParagraph";

// The image node view calls Obsidian's Element.addClass (no jsdom
// equivalent; vitest.setup.ts only installs the create* globals). Install
// the minimal class helpers so the node view actually initializes in these
// tests — same approach as the browser harness (src/browser-harness).
// Restored after the suite so nothing leaks to other test files.
const proto = Element.prototype as unknown as Record<string, unknown>;
const nativeClassMethods: Record<string, unknown> = {
  addClass: proto.addClass,
  removeClass: proto.removeClass,
  hasClass: proto.hasClass,
};
proto.addClass = function addClass(this: Element, classes: unknown) {
  for (const cls of Array.isArray(classes) ? classes : [classes]) {
    this.classList.add(cls as string);
  }
};
proto.removeClass = function removeClass(this: Element, classes: unknown) {
  for (const cls of Array.isArray(classes) ? classes : [classes]) {
    this.classList.remove(cls as string);
  }
};
proto.hasClass = function hasClass(this: Element, cls: string) {
  return this.classList.contains(cls);
};
afterAll(() => {
  for (const [name, value] of Object.entries(nativeClassMethods)) {
    if (value === undefined) {
      delete proto[name];
    } else {
      proto[name] = value;
    }
  }
});

const schema = buildSchema();

function imageJson(): JSONContent {
  return {
    type: "image",
    attrs: {
      key: "img-cell-1",
      align: "left",
      data: { id: "asset-1", size: "123", filename: "pic.png" },
    },
  };
}

function cellWithImage(cellType: "tableCell" | "tableHeader"): JSONContent {
  return {
    type: "table",
    content: [
      {
        type: "tableRow",
        content: [
          {
            type: cellType,
            content: [imageJson()],
          },
          {
            type: cellType === "tableCell" ? "tableHeader" : "tableCell",
            content: [{ type: "paragraph" }],
          },
        ],
      },
    ],
  };
}

function editorWithDoc(content: JSONContent[]) {
  return new Editor({
    element: createDiv(),
    content: {
      type: "noteDoc",
      content: [{ type: "noteTitle", content: [] }, ...content],
    } as unknown as JSONContent,
    extensions: getExtensions(),
  });
}

describe("image inside table cells (schema)", () => {
  it("accepts an image node as cell content in tableCell and tableHeader", () => {
    for (const cellType of ["tableCell", "tableHeader"] as const) {
      const node = schema.nodeFromJSON(cellWithImage(cellType));
      // throws RangeError on schema violation
      expect(() => node.check()).not.toThrow();
    }
  });

  it("a new empty cell still fills with a paragraph, not an image", () => {
    for (const cellType of [schema.nodes.tableCell, schema.nodes.tableHeader]) {
      const filled = cellType.createAndFill();
      expect(filled).not.toBeNull();
      expect(filled!.firstChild?.type.name).toBe("paragraph");
    }
  });

  it("round-trips a doc with an image in a cell through parse/serialize", () => {
    const editor = editorWithDoc([cellWithImage("tableCell")]);
    const json = editor.getJSON() as JSONContent;
    editor.destroy();

    const tableJson = (json.content as JSONContent[]).find(
      (n) => n.type === "table",
    );
    const cell = tableJson?.content?.[0]?.content?.[0];
    expect(cell?.content?.[0]?.type).toBe("image");
    expect(cell?.content?.[0]?.attrs?.data).toMatchObject({ id: "asset-1" });

    // The serialized JSON parses back into the schema.
    const reparsed = schema.nodeFromJSON(tableJson!);
    expect(() => reparsed.check()).not.toThrow();
  });

  it("inserts an image at the caret inside a cell and keeps it there", () => {
    const editor = editorWithDoc([
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              { type: "tableHeader", content: [{ type: "paragraph" }] },
              { type: "tableCell", content: [{ type: "paragraph" }] },
            ],
          },
        ],
      },
    ]);

    // Place the caret inside the body cell's paragraph.
    let cellTextPos = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "tableCell" && node.childCount > 0) {
        cellTextPos = pos + 1;
        return false;
      }
      return true;
    });
    expect(cellTextPos).toBeGreaterThan(0);
    editor.commands.setTextSelection(cellTextPos);

    const ok = editor.commands.insertContent(imageJson());
    expect(ok).toBe(true);

    // The image is inside the cell, not a sibling of the table.
    let found: { parent: string; index: number } | null = null;
    const walk = (
      node: {
        type: { name: string };
        childCount: number;
        child: (i: number) => any;
      },
      parentName: string,
    ): void => {
      for (let i = 0; i < node.childCount; i += 1) {
        const child = node.child(i);
        if (child.type.name === "image") {
          found = { parent: parentName, index: i };
          return;
        }
        walk(child, child.type.name);
        if (found != null) return;
      }
    };
    walk(editor.state.doc, "doc");
    expect(found).toEqual({ parent: "tableCell", index: 0 });
    editor.destroy();
  });

  it("keeps a trailing paragraph after an image inserted into a cell", () => {
    const editor = editorWithDoc([
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              { type: "tableHeader", content: [{ type: "paragraph" }] },
              { type: "tableCell", content: [{ type: "paragraph" }] },
            ],
          },
        ],
      },
    ]);
    let cellTextPos = -1;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "tableCell" && node.childCount > 0) {
        cellTextPos = pos + 1;
        return false;
      }
      return true;
    });
    editor.commands.setTextSelection(cellTextPos);
    editor.commands.insertContent(imageJson());

    // The insert lands before the (empty) cell paragraph; if it replaced it,
    // the cell-trailing plugin must have restored a paragraph after it.
    const cellChildren: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === "tableCell") {
        node.forEach((child) => cellChildren.push(child.type.name));
        return false;
      }
      return true;
    });
    expect(cellChildren[cellChildren.length - 1]).toBe("paragraph");
    editor.destroy();
  });

  it("edit-time repair is scoped to the changed ranges", () => {
    // Initial doc: cell holds ONLY an image — a pre-existing violation (as
    // an external/imported doc could carry). The edit-time plugin scans
    // only the cells touched by the edit: an unrelated edit elsewhere must
    // NOT repair it (read-time normalization is responsible for those —
    // parseNoteDoc and UmNotepad.prepareNote).
    const editor = editorWithDoc([
      cellWithImage("tableCell"),
      { type: "paragraph", content: [{ type: "text", text: "anchor" }] },
    ]);

    const cellChildren = (): string[] => {
      const names: string[] = [];
      editor.state.doc.descendants((node) => {
        if (node.type.name === "tableCell") {
          node.forEach((child) => names.push(child.type.name));
          return false;
        }
        return true;
      });
      return names;
    };
    expect(cellChildren()).toEqual(["image"]);

    editor.commands.setTextSelection(1);
    editor.commands.insertContent({ type: "horizontalRule" });

    expect(cellChildren()).toEqual(["image"]);
    editor.destroy();
  });

  it("edit-time repair fires when the edit itself creates the violation", () => {
    // Cell [image, paragraph]: deleting the trailing paragraph leaves the
    // image as the last block — the repair restores a caret place in the
    // same flush.
    const editor = editorWithDoc([
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              {
                type: "tableCell",
                content: [imageJson(), { type: "paragraph" }],
              },
            ],
          },
        ],
      },
    ]);

    const cellChildren = (): string[] => {
      const names: string[] = [];
      editor.state.doc.descendants((node) => {
        if (node.type.name === "tableCell") {
          node.forEach((child) => names.push(child.type.name));
          return false;
        }
        return true;
      });
      return names;
    };
    expect(cellChildren()).toEqual(["image", "paragraph"]);

    // Select the paragraph after the image and delete it.
    let paraFrom = -1;
    let paraTo = -1;
    let imageSeen = false;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "image") {
        imageSeen = true;
        return true;
      }
      if (imageSeen && node.type.name === "paragraph" && paraFrom < 0) {
        paraFrom = pos;
        paraTo = pos + node.nodeSize;
        return false;
      }
      return true;
    });
    expect(paraFrom).toBeGreaterThan(0);
    editor.view.dispatch(
      editor.state.tr.delete(paraFrom, paraTo).scrollIntoView(),
    );
    expect(cellChildren()).toEqual(["image", "paragraph"]);
    editor.destroy();
  });

  it("one transaction touching several cells repairs them all", () => {
    const editor = editorWithDoc([{ type: "paragraph" }]);

    // A table where BOTH cells end on an image, swapped in with a single
    // ReplaceStep (the paste-over-selection shape).
    // Build the violating table with the EDITOR's schema instance — nodes
    // from another schema instance are silently dropped by ReplaceStep.
    const es = editor.state.schema;
    const violating = es.nodeFromJSON({
      type: "table",
      content: [
        {
          type: "tableRow",
          content: [
            { type: "tableCell", content: [imageJson()] },
            { type: "tableCell", content: [imageJson()] },
          ],
        },
      ],
    });
    // Replace the whole top-level paragraph (closed range) with the table.
    let paraFrom = -1;
    let paraTo = -1;
    editor.state.doc.forEach((node, offset) => {
      if (node.type.name === "paragraph") {
        paraFrom = offset;
        paraTo = offset + node.nodeSize;
      }
    });
    expect(paraFrom).toBeGreaterThan(0);
    const tr = editor.state.tr;
    tr.replaceWith(paraFrom, paraTo, [violating]);
    editor.view.dispatch(tr);

    const cells: string[][] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === "tableCell") {
        const kids: string[] = [];
        node.forEach((child) => kids.push(child.type.name));
        cells.push(kids);
        return false;
      }
      return true;
    });
    expect(cells).toEqual([
      ["image", "paragraph"],
      ["image", "paragraph"],
    ]);
    editor.destroy();
  });

  it("read-time JSON normalization appends a paragraph to cells ending on an image", () => {
    const raw = cellWithImage("tableCell");
    // The header cell in the fixture ends on a paragraph; only the image
    // cell needs the repair.
    const fixed = ensureCellTrailingParagraphJSON(
      JSON.parse(JSON.stringify(raw)),
    );
    const cell = fixed.content?.[0]?.content?.[0];
    expect(cell?.content?.map((n: JSONContent) => n.type)).toEqual([
      "image",
      "paragraph",
    ]);
    // Idempotent: a second pass changes nothing.
    expect(ensureCellTrailingParagraphJSON(fixed)).toEqual(fixed);
    // Nested tables get repaired too.
    const nested: JSONContent = {
      type: "tableCell",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                { type: "tableCell", content: [imageJson()] },
                { type: "tableCell", content: [{ type: "paragraph" }] },
              ],
            },
          ],
        },
      ],
    };
    const fixedNested = ensureCellTrailingParagraphJSON(
      JSON.parse(JSON.stringify(nested)),
    );
    const inner = fixedNested.content?.[0]?.content?.[0]?.content?.[0];
    expect(inner?.content?.map((n: JSONContent) => n.type)).toEqual([
      "image",
      "paragraph",
    ]);
  });

  it("parseNoteDoc normalizes a file whose cell ends on an image", () => {
    const doc = {
      type: "noteDoc",
      content: [{ type: "noteTitle", content: [] }, cellWithImage("tableCell")],
    };
    const parsed = parseNoteDoc(JSON.stringify(doc));
    const cell = parsed.content?.find((n) => n.type === "table")?.content?.[0]
      ?.content?.[0];
    expect(cell?.content?.map((n) => n.type)).toEqual(["image", "paragraph"]);
  });

  it("copy/paste of a table with an image round-trips through the clipboard DOM", () => {
    const editor = editorWithDoc([cellWithImage("tableCell")]);
    const view = editor.view;

    // Select the whole table (the copy source).
    let tableFrom = -1;
    let tableSize = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "table") {
        tableFrom = pos;
        tableSize = node.nodeSize;
        return false;
      }
      return true;
    });
    const slice = editor.state.doc.slice(tableFrom, tableFrom + tableSize);
    const { dom } = view.serializeForClipboard(slice);

    const parsed = DOMParser.fromSchema(editor.state.schema).parseSlice(dom);
    let foundParent: string | null = null;
    const walkFragment = (
      fragment: { childCount: number; child: (i: number) => any },
      parentName: string,
    ): void => {
      for (let i = 0; i < fragment.childCount; i += 1) {
        const child = fragment.child(i);
        if (child.type.name === "image" && foundParent == null) {
          foundParent = parentName;
          return;
        }
        walkFragment(child.content, child.type.name);
      }
    };
    walkFragment(parsed.content, "slice");
    expect(foundParent).toBe("tableCell");
    editor.destroy();
  });
});
