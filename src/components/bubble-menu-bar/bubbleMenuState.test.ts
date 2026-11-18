import { describe, it, expect } from "vitest";
import type { Mark, Node } from "prosemirror-model";
import type { Editor } from "../../texto/core";
import { EditorState, NodeSelection, TextSelection } from "prosemirror-state";
import { CellSelection } from "prosemirror-tables";
import { buildSchema } from "../../../tests/helpers/buildSchema";
import { createTable } from "../../texto/extensions/table/helpers/createTable";
import { getBubbleMenuState, getSelectionMarkSpreads, TEXT_COLORS } from "./bubbleMenuState";

const schema = buildSchema();

function makeEditor(
  active: Record<string, boolean>,
  attrs: Record<string, Record<string, unknown>> = {},
): Pick<Editor, "isActive" | "getAttributes"> {
  return {
    // Editor.isActive has two overloads: (name, attributes?) and (attributes).
    // The mock accepts both; only the (name, attributes) form is exercised.
    isActive(
      nameOrAttributes: string | object,
      attributesOrUndefined?: object,
    ) {
      const name = typeof nameOrAttributes === "string" ? nameOrAttributes : "";
      const a =
        typeof nameOrAttributes === "string"
          ? attributesOrUndefined
          : nameOrAttributes;
      if (name === "heading")
        // The bare (name) form and the (name, attributes) form are both
        // exercised: the bare one asks "is a heading", the second one
        // pins the level.
        return a == null
          ? (active["heading"] ?? false)
          : (active[`heading${(a as { level?: number }).level}`] ?? false);
      return active[name] ?? false;
    },
    getAttributes(name: string) {
      return attrs[name] ?? {};
    },
  };
}

describe("getBubbleMenuState", () => {
  it("all false by default", () => {
    expect(getBubbleMenuState(makeEditor({}))).toEqual({
      bold: false,
      italic: false,
      underline: false,
      strike: false,
      code: false,
      mark: false,
      link: false,
      paragraph: false,
      h1: false,
      h2: false,
      h3: false,
      quote: false,
      list: false,
      taskList: false,
      align: "left",
      color: null,
    });
  });

  it("reports the paragraph alignment (left is the absence)", () => {
    expect(
      getBubbleMenuState(makeEditor({ paragraph: true }, { paragraph: { align: "center" } })).align,
    ).toBe("center");
    expect(
      getBubbleMenuState(makeEditor({ paragraph: true }, { paragraph: {} })).align,
    ).toBe("left");
    expect(
      getBubbleMenuState(makeEditor({ heading: true, heading1: true }, { heading: { align: "right" } })).align,
    ).toBe("right");
  });

  it("detects inline marks", () => {
    const s = getBubbleMenuState(
      makeEditor({
        bold: true,
        italic: true,
        strike: false,
        code: true,
        highlight: true,
        link: true,
      }),
    );
    expect(s.bold).toBe(true);
    expect(s.italic).toBe(true);
    expect(s.strike).toBe(false);
    expect(s.code).toBe(true);
    expect(s.mark).toBe(true);
    expect(s.link).toBe(true);
  });

  it("detects headings separately", () => {
    const s = getBubbleMenuState(
      makeEditor({ heading1: true, heading2: false, heading3: false }),
    );
    expect(s.h1).toBe(true);
    expect(s.h2).toBe(false);
    expect(s.h3).toBe(false);
  });

  it("detects blocks and lists", () => {
    const s = getBubbleMenuState(
      makeEditor({
        paragraph: true,
        blockquote: false,
        bulletList: false,
        orderedList: true,
      }),
    );
    expect(s.paragraph).toBe(true);
    expect(s.quote).toBe(false);
    expect(s.list).toBe(true); // bulletList OR orderedList
  });

  it("reads text color from textStyle attrs", () => {
    const s = getBubbleMenuState(
      makeEditor({}, { textStyle: { color: "#4ade80" } }),
    );
    expect(s.color).toBe("#4ade80");
  });

  it("returns null color when textStyle absent", () => {
    expect(getBubbleMenuState(makeEditor({})).color).toBe(null);
  });
});

describe("TEXT_COLORS", () => {
  it("unified palette: default reset + the extended 11 colors, no dups", () => {
    expect(TEXT_COLORS.map((c) => c.id)).toEqual([
      "none",
      "violet",
      "green",
      "yellow",
      "red",
      "orange",
      "blue",
      "teal",
      "pink",
      "gray",
      "white",
      "black",
    ]);
    expect(TEXT_COLORS[0].color).toBe(null);
    const hexes = TEXT_COLORS.slice(1).map((c) => c.color);
    expect(new Set(hexes).size).toBe(hexes.length);
    for (const hex of hexes) expect(hex).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("getSelectionMarkSpreads", () => {
  const para = (text: string, marks?: readonly Mark[]) =>
    schema.nodes.paragraph.create(null, [schema.text(text, marks)]);

  const boldMark = () => schema.marks.bold.create();
  const italicMark = () => schema.marks.italic.create();
  const colorMark = (color: string) =>
    schema.marks.textStyle.create({ color });

  function stateOf(doc: Node, sel: { from: number; to?: number }) {
    return EditorState.create({
      doc,
      selection: TextSelection.create(doc, sel.from, sel.to ?? sel.from),
    });
  }

  it("caret reports stored marks as all/none, never mixed", () => {
    const doc = schema.nodes.noteDoc.create(null, [para("alpha", [boldMark()])]);
    const before = stateOf(doc, { from: 1 });
    expect(before.selection.empty).toBe(true);
    expect(getSelectionMarkSpreads(before).bold).toBe("all");
    expect(getSelectionMarkSpreads(before).italic).toBe("none");

    const after = stateOf(doc, { from: 7 });
    expect(getSelectionMarkSpreads(after).bold).toBe("none");
  });

  it("uniform selection reports all", () => {
    const doc = schema.nodes.noteDoc.create(null, [para("alpha", [boldMark()])]);
    const state = stateOf(doc, { from: 1, to: 6 });
    expect(getSelectionMarkSpreads(state).bold).toBe("all");
    expect(getSelectionMarkSpreads(state).italic).toBe("none");
  });

  it("partly formatted selection reports mixed", () => {
    const doc = schema.nodes.noteDoc.create(null, [
      schema.nodes.paragraph.create(null, [
        schema.text("alpha", [boldMark()]),
        schema.text(" bold"),
      ]),
    ]);
    // "alpha bold" — the marked part plus the unmarked " bold".
    const state = stateOf(doc, { from: 1, to: 11 });
    expect(getSelectionMarkSpreads(state).bold).toBe("mixed");
    expect(getSelectionMarkSpreads(state).italic).toBe("none");
  });

  it("mixed colors are reported as mixed, not as a single color", () => {
    const doc = schema.nodes.noteDoc.create(null, [
      schema.nodes.paragraph.create(null, [
        schema.text("alpha", [colorMark("#ff0000")]),
        schema.text(" bravo", [colorMark("#00ff00")]),
      ]),
    ]);
    const state = stateOf(doc, { from: 1, to: 11 });
    const spreads = getSelectionMarkSpreads(state);
    expect(spreads.color).toBeNull();
    expect(spreads.colorMixed).toBe(true);
  });

  it("uniform color survives a multi-block selection", () => {
    const doc = schema.nodes.noteDoc.create(null, [
      para("alpha", [colorMark("#123456")]),
      para("bravo", [colorMark("#123456")]),
    ]);
    const state = stateOf(doc, { from: 1, to: 12 });
    const spreads = getSelectionMarkSpreads(state);
    expect(spreads.color).toBe("#123456");
    expect(spreads.colorMixed).toBe(false);
  });

  it("a selection without text nodes reports no color and no marks", () => {
    const doc = schema.nodes.noteDoc.create(null, [
      para("alpha"),
      schema.nodes.image.create({
        key: "img",
        state: "done",
        data: { id: "x.png", size: 3, source: "vault" },
      }),
    ]);
    let imagePos = 0;
    doc.descendants((node, pos) => {
      if (node.type.name === "image") imagePos = pos;
      return true;
    });
    const state = EditorState.create({
      doc,
      selection: NodeSelection.create(doc, imagePos),
    });
    const spreads = getSelectionMarkSpreads(state);
    expect(spreads.bold).toBe("none");
    expect(spreads.color).toBeNull();
    expect(spreads.colorMixed).toBe(false);
  });

  it("a colorless textStyle mark is not reported as a color", () => {
    const doc = schema.nodes.noteDoc.create(null, [
      schema.nodes.paragraph.create(null, [
        schema.text("alpha", [schema.marks.textStyle.create({})]),
        schema.text(" bravo"),
      ]),
    ]);
    const state = stateOf(doc, { from: 1, to: 11 });
    const spreads = getSelectionMarkSpreads(state);
    expect(spreads.color).toBeNull();
    expect(spreads.colorMixed).toBe(false);
  });

  it("a cell selection reads the marks across the cell text", () => {
    const cellContent = schema.nodes.paragraph.create(null, schema.text("alpha"));
    const table = createTable(schema, 2, 2, false, cellContent);
    const positions: number[] = [];
    table.descendants((node, pos) => {
      if (node.type.name === "tableCell") positions.push(pos);
      return true;
    });
    const state = EditorState.create({
      doc: table,
      selection: CellSelection.create(table, positions[0], positions[positions.length - 1]),
    });
    expect(state.selection.empty).toBe(false);
    const spreads = getSelectionMarkSpreads(state);
    expect(spreads.bold).toBe("none");
    expect(spreads.underline).toBe("none");
    expect(spreads.link).toBe("none");
    expect(spreads.color).toBeNull();
    expect(spreads.colorMixed).toBe(false);
  });
});
