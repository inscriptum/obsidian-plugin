import { describe, it, expect } from "vitest";
import type { Mark, Node } from "prosemirror-model";
import type { Editor } from "../../texto/core";
import { EditorState, NodeSelection, TextSelection } from "prosemirror-state";
import { CellSelection } from "prosemirror-tables";
import { buildSchema } from "../../../tests/helpers/buildSchema";
import { createTable } from "../../texto/extensions/table/helpers/createTable";
import { isMarkActive } from "../../texto/core/helpers/isMarkActive";
import {
  getBubbleMenuState,
  getSelectionMarkSpreads,
  HIGHLIGHT_COLORS,
  TEXT_COLORS,
} from "./bubbleMenuState";

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
      markColor: null,
    });
  });

  it("reports the paragraph alignment (left is the absence)", () => {
    expect(
      getBubbleMenuState(
        makeEditor({ paragraph: true }, { paragraph: { align: "center" } }),
      ).align,
    ).toBe("center");
    expect(
      getBubbleMenuState(makeEditor({ paragraph: true }, { paragraph: {} }))
        .align,
    ).toBe("left");
    expect(
      getBubbleMenuState(
        makeEditor(
          { heading: true, heading1: true },
          { heading: { align: "right" } },
        ),
      ).align,
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

  it("reads highlight color from the mark attrs", () => {
    const color = HIGHLIGHT_COLORS[0].color;
    const s = getBubbleMenuState(
      makeEditor({ highlight: true }, { highlight: { color } }),
    );
    expect(s.mark).toBe(true);
    expect(s.markColor).toBe(color);
  });

  it("a colorless highlight mark reports null markColor — the theme default", () => {
    const s = getBubbleMenuState(
      makeEditor({ highlight: true }, { highlight: { color: null } }),
    );
    expect(s.mark).toBe(true);
    expect(s.markColor).toBe(null);
  });

  it("no highlight mark reports null markColor", () => {
    expect(
      getBubbleMenuState(makeEditor({ highlight: false })).markColor,
    ).toBe(null);
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

describe("HIGHLIGHT_COLORS", () => {
  it("fixed set: one swatch per gamma, no default entry, no dups", () => {
    expect(HIGHLIGHT_COLORS.map((c) => c.id)).toEqual([
      "yellow",
      "orange",
      "green",
      "blue",
      "purple",
      "red",
    ]);
    // No "default" swatch: a colorless mark IS the theme default, and the
    // way back from a colored mark is the active swatch or the toggle.
    expect(HIGHLIGHT_COLORS.every((c) => c.color != null)).toBe(true);
    const colors = HIGHLIGHT_COLORS.map((c) => c.color);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it("swatches are translucent rgba — inherited text stays readable", () => {
    for (const c of HIGHLIGHT_COLORS) {
      const m = c.color.match(
        /^rgba\(\d{1,3}, \d{1,3}, \d{1,3}, 0\.3\)$/,
      );
      expect(m).not.toBe(null);
      const [r, g, b, a] = c.color
        .slice(5, -1)
        .split(", ")
        .map(Number) as [number, number, number, number];
      expect(r).toBeLessThanOrEqual(255);
      expect(g).toBeLessThanOrEqual(255);
      expect(b).toBeLessThanOrEqual(255);
      expect(a).toBeGreaterThan(0);
      expect(a).toBeLessThan(1);
    }
  });

  it("a stored attrs.color maps back to exactly one swatch", () => {
    const color = HIGHLIGHT_COLORS[2].color; // green
    const swatch = HIGHLIGHT_COLORS.find((c) => c.color === color);
    expect(swatch?.id).toBe("green");
    // A foreign color (old documents, custom values) maps to no swatch.
    expect(HIGHLIGHT_COLORS.find((c) => c.color === "#123456")).toBe(
      undefined,
    );
  });
});

describe("getSelectionMarkSpreads", () => {
  const para = (text: string, marks?: readonly Mark[]) =>
    schema.nodes.paragraph.create(null, [schema.text(text, marks)]);

  const boldMark = () => schema.marks.bold.create();
  const italicMark = () => schema.marks.italic.create();
  const colorMark = (color: string) => schema.marks.textStyle.create({ color });

  function stateOf(doc: Node, sel: { from: number; to?: number }) {
    return EditorState.create({
      doc,
      selection: TextSelection.create(doc, sel.from, sel.to ?? sel.from),
    });
  }

  it("caret reports stored marks as all/none, never mixed", () => {
    const doc = schema.nodes.noteDoc.create(null, [
      para("alpha", [boldMark()]),
    ]);
    const before = stateOf(doc, { from: 1 });
    expect(before.selection.empty).toBe(true);
    expect(getSelectionMarkSpreads(before).bold).toBe("all");
    expect(getSelectionMarkSpreads(before).italic).toBe("none");

    const after = stateOf(doc, { from: 7 });
    expect(getSelectionMarkSpreads(after).bold).toBe("none");
  });

  it("uniform selection reports all", () => {
    const doc = schema.nodes.noteDoc.create(null, [
      para("alpha", [boldMark()]),
    ]);
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
    const cellContent = schema.nodes.paragraph.create(
      null,
      schema.text("alpha"),
    );
    const table = createTable(schema, 2, 2, false, cellContent);
    const positions: number[] = [];
    table.descendants((node, pos) => {
      if (node.type.name === "tableCell") positions.push(pos);
      return true;
    });
    const state = EditorState.create({
      doc: table,
      selection: CellSelection.create(
        table,
        positions[0],
        positions[positions.length - 1],
      ),
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

describe("getSelectionMarkSpreads — exclusive-mark neutrality", () => {
  // Inline code excludes every other mark (excludes: "_"), so text inside
  // code cannot carry bold/italic/etc. isMarkActive counts that text as
  // covered when part is matched — the spreads must predict the toggle.
  const boldMark = () => schema.marks.bold.create();
  const codeMark = () => schema.marks.code.create();
  const para = (...runs: ReturnType<typeof schema.text>[]) =>
    schema.nodes.paragraph.create(null, runs);
  const stateOf = (doc: Node, sel: { from: number; to?: number }) =>
    EditorState.create({
      doc,
      selection: TextSelection.create(doc, sel.from, sel.to ?? sel.from),
    });

  it("[bold][code] reports bold all — the toggle will remove it", () => {
    const doc = schema.nodes.noteDoc.create(null, [
      para(
        schema.text("alpha", [boldMark()]),
        schema.text(" bravo", [codeMark()]),
      ),
    ]);
    const state = stateOf(doc, { from: 1, to: 11 });
    const spreads = getSelectionMarkSpreads(state);
    expect(spreads.bold).toBe("all");
    // Code itself is partly present: toggling code would paint the plain
    // run (replacing its bold) — "mixed" predicts that.
    expect(spreads.code).toBe("mixed");
  });

  it("[plain][code] reports bold none — the toggle will add it", () => {
    const doc = schema.nodes.noteDoc.create(null, [
      para(schema.text("alpha"), schema.text(" bravo", [codeMark()])),
    ]);
    const state = stateOf(doc, { from: 1, to: 11 });
    expect(getSelectionMarkSpreads(state).bold).toBe("none");
  });

  it("[bold][code][bold] reports bold all", () => {
    const doc = schema.nodes.noteDoc.create(null, [
      para(
        schema.text("a", [boldMark()]),
        schema.text(" b ", [codeMark()]),
        schema.text("c", [boldMark()]),
      ),
    ]);
    const state = stateOf(doc, { from: 1, to: 6 });
    expect(getSelectionMarkSpreads(state).bold).toBe("all");
  });

  it("[plain][code][bold] reports bold mixed — partly coverable", () => {
    const doc = schema.nodes.noteDoc.create(null, [
      para(
        schema.text("a"),
        schema.text(" b ", [codeMark()]),
        schema.text("c", [boldMark()]),
      ),
    ]);
    const state = stateOf(doc, { from: 1, to: 6 });
    expect(getSelectionMarkSpreads(state).bold).toBe("mixed");
  });

  it("a selection entirely inside code reports bold none (toggle is a no-op there)", () => {
    const doc = schema.nodes.noteDoc.create(null, [
      para(schema.text(" bravo", [codeMark()])),
    ]);
    const state = stateOf(doc, { from: 1, to: 7 });
    expect(getSelectionMarkSpreads(state).bold).toBe("none");
    expect(getSelectionMarkSpreads(state).code).toBe("all");
  });

  it("[linked][code] reports link all — same coverage rule", () => {
    const doc = schema.nodes.noteDoc.create(null, [
      para(
        schema.text("alpha", [
          schema.marks.link.create({ href: "https://example.com" }),
        ]),
        schema.text(" bravo", [codeMark()]),
      ),
    ]);
    const state = stateOf(doc, { from: 1, to: 11 });
    expect(getSelectionMarkSpreads(state).link).toBe("all");
  });
});

describe("getSelectionMarkSpreads — parity with the toggle decision", () => {
  // The dock displays spreads; toggleMark decides via isMarkActive. For
  // every mixed code/bold selection the displayed state must predict the
  // toggle: "all" ⇔ isMarkActive true (tap removes), otherwise the toggle
  // adds (tap paints).
  const boldMark = () => schema.marks.bold.create();
  const codeMark = () => schema.marks.code.create();
  const mkState = (
    runs: Array<{ text: string; marks?: Mark[] }>,
    to: number,
  ) => {
    const doc = schema.nodes.noteDoc.create(null, [
      schema.nodes.paragraph.create(
        null,
        runs.map((r) => schema.text(r.text, r.marks)),
      ),
    ]);
    return EditorState.create({
      doc,
      selection: TextSelection.create(doc, 1, to),
    });
  };

  const scenarios = [
    {
      name: "[bold][code]",
      runs: [
        { text: "alpha", marks: [boldMark()] },
        { text: " bravo", marks: [codeMark()] },
      ],
      to: 11,
    },
    {
      name: "[plain][code]",
      runs: [{ text: "alpha" }, { text: " bravo", marks: [codeMark()] }],
      to: 11,
    },
    {
      name: "[bold][plain]",
      runs: [{ text: "alpha", marks: [boldMark()] }, { text: " bravo" }],
      to: 11,
    },
    {
      name: "[bold][code][bold]",
      runs: [
        { text: "a", marks: [boldMark()] },
        { text: " b ", marks: [codeMark()] },
        { text: "c", marks: [boldMark()] },
      ],
      to: 6,
    },
    {
      name: "[plain][code][bold]",
      runs: [
        { text: "a" },
        { text: " b ", marks: [codeMark()] },
        { text: "c", marks: [boldMark()] },
      ],
      to: 6,
    },
    {
      name: "[code only]",
      runs: [{ text: " bravo", marks: [codeMark()] }],
      to: 7,
    },
  ];

  for (const s of scenarios) {
    it(`${s.name}: displayed bold state predicts the toggle`, () => {
      const state = mkState(s.runs, s.to);
      const active = isMarkActive(state, "bold");
      const spread = getSelectionMarkSpreads(state).bold;
      // "all" ⇔ the toggle removes; "mixed" ⇔ it paints; "none" ⇔ the
      // mark is absent (the toggle only ever adds).
      expect(spread === "all").toBe(active);
    });
  }
});
