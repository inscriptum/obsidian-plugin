import { describe, expect, it } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import type { Node as PMNode } from "prosemirror-model";
import { getProfileSchema } from "../../editorSchemas";
import type { JSONContent } from "../../core/@types";
import {
  PROPERTY_NAME_PRESETS,
  acceptSuggestion,
  insertProperty,
  isDuplicateTag,
  isPresetName,
  presetType,
  propertyInsertPos,
  moveProperty,
  removeProperty,
  propertyKeyDown,
  selectionProperty,
  stateProperty,
  sanitizePropertyValues,
  suggestionItems,
} from "./notePropertyModel";

const schema = getProfileSchema("title");

function property(
  name: string,
  values: string[],
  type: "text" | "list" = "text",
): JSONContent {
  return {
    type: "noteProperty",
    attrs: { type },
    content: [
      {
        type: "notePropertyName",
        content: name ? [{ type: "text", text: name }] : [],
      },
      ...values.map((value) => ({
        type: "notePropertyValue",
        content: value ? [{ type: "text", text: value }] : [],
      })),
    ],
  };
}

function v3Doc(properties: JSONContent[]): JSONContent {
  return {
    type: "noteDoc",
    content: [
      { type: "noteTitle", content: [{ type: "text", text: "Cover" }] },
      ...properties,
      { type: "paragraph" },
    ],
  };
}

function stateAt(json: JSONContent, caretPos: number): EditorState {
  const doc = schema.nodeFromJSON(json);
  const base = EditorState.create({ doc });
  return base.apply(base.tr.setSelection(TextSelection.create(doc, caretPos)));
}

/** Run a model command with a dispatch that applies onto `base`; returns
 *  the resulting state (commands dispatch at most once). */
function applied(
  base: EditorState,
  run: (dispatch: (tr: import("prosemirror-state").Transaction) => void) => boolean,
): EditorState {
  const out: EditorState[] = [];
  run((tr) => out.push(base.apply(tr)));
  return out[0]!;
}

/** Property geometry in a built doc: content-start positions. */
function geometry(doc: PMNode): {
  from: number;
  nameFrom: number;
  values: number[];
}[] {
  const out: { from: number; nameFrom: number; values: number[] }[] = [];
  doc.forEach((node, offset) => {
    if (node.type.name !== "noteProperty") return;
    const from = offset;
    const entry = { from, nameFrom: -1, values: [] as number[] };
    let childStart = from + 1;
    node.forEach((child) => {
      // childStart = the child node's start; content starts one inside.
      if (child.type.name === "notePropertyName") entry.nameFrom = childStart + 1;
      else entry.values.push(childStart + 1);
      childStart += child.nodeSize;
    });
    out.push(entry);
  });
  return out;
}

describe("presets", () => {
  it("recognizes preset names case-insensitively and trims input", () => {
    expect(isPresetName("description")).toBe(true);
    expect(isPresetName("  Tags ")).toBe(true);
    expect(isPresetName("custom")).toBe(false);
    expect(isPresetName("")).toBe(false);
  });

  it("maps tags to a list and the rest to text; unknown names have no type", () => {
    expect(presetType("tags")).toBe("list");
    expect(presetType("description")).toBe("text");
    expect(presetType("status")).toBe("text");
    expect(presetType("version")).toBe("text");
    expect(presetType("custom")).toBeNull();
  });
});

describe("suggestionItems", () => {
  it("offers all presets for an empty name", () => {
    expect(suggestionItems("")).toEqual([...PROPERTY_NAME_PRESETS]);
  });

  it("filters by a case-insensitive prefix and skips exact matches", () => {
    expect(suggestionItems("de")).toEqual(["description"]);
    expect(suggestionItems("DESC")).toEqual(["description"]);
    expect(suggestionItems("status")).toEqual([]);
    expect(suggestionItems("custom")).toEqual([]);
  });

  it("does not offer presets already present in the document", () => {
    expect(suggestionItems("", ["tags"])).toEqual(["description", "status", "version"]);
    expect(suggestionItems("t", ["tags"])).toEqual([]);
    expect(suggestionItems("d", ["tags", "Custom"])).toEqual(["description"]);
  });
});

describe("propertyInsertPos", () => {
  it("puts the first row right after the title, the next after the last row", () => {
    const afterTitle = propertyInsertPos(schema.nodeFromJSON(v3Doc([])));
    expect(afterTitle).toBeGreaterThan(0);

    const withProp = schema.nodeFromJSON(
      v3Doc([property("description", ["x"])]),
    );
    const afterProp = propertyInsertPos(withProp);
    expect(afterProp!).toBeGreaterThan(afterTitle!);
    // The row inserts before the trailing content block.
    expect(afterProp).toBeLessThanOrEqual(withProp.content.size - 1);
  });

  it("refuses documents without a leading title node", () => {
    const doc = schema.nodeFromJSON({
      type: "noteDoc",
      content: [{ type: "paragraph" }],
    });
    expect(propertyInsertPos(doc)).toBeNull();
  });
});

describe("selectionProperty", () => {
  const json = v3Doc([property("description", ["The summary"])]);
  const doc = schema.nodeFromJSON(json);
  const [geo] = geometry(doc);

  it("resolves the name field", () => {
    const loc = selectionProperty(doc, TextSelection.create(doc, geo.nameFrom));
    expect(loc).toMatchObject({
      inName: true,
      nameText: "description",
      valueIndex: -1,
      isEmpty: false,
    });
  });

  it("resolves the value field and its index", () => {
    const loc = selectionProperty(doc, TextSelection.create(doc, geo.values[0]));
    expect(loc).toMatchObject({ inName: false, valueIndex: 0 });
  });

  it("returns null outside property rows", () => {
    // Caret inside the title (pos 1) and inside the trailing paragraph.
    expect(selectionProperty(doc, TextSelection.create(doc, 1))).toBeNull();
    expect(
      selectionProperty(doc, TextSelection.create(doc, doc.content.size - 1)),
    ).toBeNull();
  });
});

describe("insertProperty", () => {
  it("appends a row before the content and focuses its name", () => {
    const base = EditorState.create({
      doc: schema.nodeFromJSON(v3Doc([property("tags", ["one"], "list")])),
    });
    const next = applied(base, (dispatch) => insertProperty(base, dispatch));

    expect(next.doc.content.content.map((n) => n.type.name)).toEqual([
      "noteTitle",
      "noteProperty",
      "noteProperty",
      "paragraph",
    ]);
    const loc = stateProperty(next)!;
    expect(loc.inName).toBe(true);
    expect(loc.nameText).toBe("");
  });
});

describe("removeProperty", () => {
  it("deletes the row and parks the caret at the previous block end", () => {
    const json = v3Doc([property("tags", ["one"], "list")]);
    const doc = schema.nodeFromJSON(json);
    const [geo] = geometry(doc);
    const base = stateAt(json, geo.values[0]);
    const loc = stateProperty(base)!;

    const next = applied(base, (dispatch) => removeProperty(base, dispatch, loc));
    expect(next.doc.content.content.map((n) => n.type.name)).toEqual([
      "noteTitle",
      "paragraph",
    ]);
    // Caret lands inside surviving content (the title), not on a boundary.
    expect(next.selection.from).toBeGreaterThan(0);
    expect(next.selection.from).toBeLessThan(7);
  });
});

describe("isDuplicateTag", () => {
  it("matches siblings case-insensitively with trimming; ignores self and empty", () => {
    const json = v3Doc([property("tags", ["one", "Two "], "list")]);
    const loc = selectionProperty(
      schema.nodeFromJSON(json),
      TextSelection.create(schema.nodeFromJSON(json), 1),
    )!;
    // build via selectionProperty on a real caret: use stateProperty path instead
    const doc = schema.nodeFromJSON(json);
    const [geo] = geometry(doc);
    const withCaret = stateAt(json, geo.values[0]);
    const loc2 = stateProperty(withCaret)!;
    expect(isDuplicateTag(loc2, 0)).toBe(false);
    expect(isDuplicateTag({ ...loc2, values: [...loc2.values, { from: 0, to: 0, size: 2, text: " two" }] }, 2)).toBe(true);
    expect(isDuplicateTag({ ...loc2, values: [{ ...loc2.values[0], text: "" }] }, 0)).toBe(false);
  });
});

describe("propertyKeyDown", () => {
  it("Enter in the name moves the caret into the first value", () => {
    const json = v3Doc([property("description", ["x"])]);
    const [geo] = geometry(schema.nodeFromJSON(json));
    const base = stateAt(json, geo.nameFrom);

    const handled = propertyKeyDown(base, "Enter", null, () => {});
    expect(handled).toBe(true);
    const next = applied(base, (dispatch) =>
      propertyKeyDown(base, "Enter", null, dispatch),
    );
    const loc = stateProperty(next)!;
    expect(loc.inName).toBe(false);
    expect(loc.valueIndex).toBe(0);
  });

  it("Enter in a Text value keeps the content and moves to the next block", () => {
    const json = v3Doc([property("description", ["first"])]);
    const doc = schema.nodeFromJSON(json);
    const [geo] = geometry(doc);
    const base = stateAt(json, geo.values[0] + 1);

    const next = applied(base, (dispatch) =>
      propertyKeyDown(base, "Enter", null, dispatch),
    );
    // Structure untouched: one value, still text.
    const prop = next.doc.content.content[1];
    expect(prop.attrs.type).toBe("text");
    expect(prop.childCount).toBe(2); // name + one value
    expect(prop.child(1).textContent).toBe("first");
    // The caret left the property for the trailing content block.
    const loc = stateProperty(next);
    expect(loc).toBeNull();
    expect(next.selection.from).toBeGreaterThan(prop.nodeSize + 2);
  });

  it("Enter in a Text value jumps to the next property's name", () => {
    const json = v3Doc([
      property("description", ["first"]),
      property("status", ["draft"]),
    ]);
    const base = stateAt(json, geometry(schema.nodeFromJSON(json))[0].values[0] + 1);

    const next = applied(base, (dispatch) =>
      propertyKeyDown(base, "Enter", null, dispatch),
    );
    const loc = stateProperty(next)!;
    expect(loc.inName).toBe(true);
    expect(loc.nameText).toBe("status");
  });

  it("Enter in a List value appends another entry", () => {
    const json = v3Doc([property("tags", ["one"], "list")]);
    const doc = schema.nodeFromJSON(json);
    const [geo] = geometry(doc);
    const base = stateAt(json, geo.values[0] + 1);

    const next = applied(base, (dispatch) =>
      propertyKeyDown(base, "Enter", null, dispatch),
    );

    const prop = next.doc.content.content[1];
    expect(prop.attrs.type).toBe("list");
    expect(prop.childCount).toBe(3); // name + two values
    expect(prop.child(1).textContent).toBe("one");
    const loc = stateProperty(next)!;
    expect(loc.valueIndex).toBe(1);
    expect(loc.values[1].text).toBe("");
  });

  it("Enter on an empty draft does nothing (a tag needs a word)", () => {
    const json = v3Doc([property("tags", ["one", ""], "list")]);
    const [geo] = geometry(schema.nodeFromJSON(json));
    const base = stateAt(json, geo.values[1]);

    let changed = false;
    const handled = propertyKeyDown(base, "Enter", null, () => {
      changed = true;
    });
    expect(handled).toBe(true);
    expect(changed).toBe(false);
  });

  it("Enter on a duplicate word is rejected (tags are unique)", () => {
    // The last chip's word duplicates an earlier tag (case-insensitive).
    const json = v3Doc([property("tags", ["one", "two", "Two"], "list")]);
    const [geo] = geometry(schema.nodeFromJSON(json));
    const base = stateAt(json, geo.values[2] + 3); // caret at the end of "Two"

    let changed = false;
    const handled = propertyKeyDown(base, "Enter", null, () => {
      changed = true;
    });
    expect(handled).toBe(true);
    expect(changed).toBe(false);
  });

  it("Backspace on the empty draft keeps it (the slot stays while focused)", () => {
    const json = v3Doc([property("tags", ["one", ""], "list")]);
    const [geo] = geometry(schema.nodeFromJSON(json));
    const base = stateAt(json, geo.values[1]);

    let changed = false;
    const handled = propertyKeyDown(base, "Backspace", null, () => {
      changed = true;
    });
    expect(handled).toBe(true);
    expect(changed).toBe(false);
  });

  it("Shift-Enter never inserts a line break inside a value", () => {
    const json = v3Doc([property("tags", ["one"], "list")]);
    const [geo] = geometry(schema.nodeFromJSON(json));
    const base = stateAt(json, geo.values[0] + 1);

    let changed = false;
    const handled = propertyKeyDown(base, "Shift-Enter", null, () => {
      changed = true;
    });
    expect(handled).toBe(true);
    expect(changed).toBe(false);
  });

  it("Backspace at the start of the first value with text never joins into the name", () => {
    const json = v3Doc([property("description", ["text"])]);
    const [geo] = geometry(schema.nodeFromJSON(json));
    const base = stateAt(json, geo.values[0]);

    let changed = false;
    const handled = propertyKeyDown(base, "Backspace", null, () => {
      changed = true;
    });
    expect(handled).toBe(true);
    expect(changed).toBe(false);
  });

  it("Backspace in an empty single value of an empty-named row removes the row", () => {
    const json = v3Doc([property("", [""])]);
    const [geo] = geometry(schema.nodeFromJSON(json));
    const base = stateAt(json, geo.values[0]);

    const handled = propertyKeyDown(base, "Backspace", null, () => {});
    expect(handled).toBe(true);
    const next = applied(base, (dispatch) =>
      propertyKeyDown(base, "Backspace", null, dispatch),
    );
    expect(next.doc.content.content.map((n) => n.type.name)).toEqual([
      "noteTitle",
      "paragraph",
    ]);
  });

  it("Shift-Tab from the first value returns the caret to the name", () => {
    const json = v3Doc([property("tags", ["one"])]);
    const [geo] = geometry(schema.nodeFromJSON(json));
    const base = stateAt(json, geo.values[0]);

    const next = applied(base, (dispatch) =>
      propertyKeyDown(base, "Shift-Tab", null, dispatch),
    );
    const loc = stateProperty(next)!;
    expect(loc.inName).toBe(true);
  });
});

describe("acceptSuggestion (preset uniqueness)", () => {
  it("rejects accepting a preset that another row already carries", () => {
    // The new (empty-named) row plus an existing tags row.
    const json = {
      type: "noteDoc",
      content: [
        { type: "noteTitle", content: [{ type: "text", text: "Cover" }] },
        property("tags", ["one"], "list"),
        property("", [""]),
        { type: "paragraph" },
      ],
    };
    const doc = schema.nodeFromJSON(json);
    const props: number[] = [];
    let p = 0;
    doc.forEach((node, off) => {
      if (node.type.name === "noteProperty") props.push(off);
      p += node.nodeSize;
    });
    const emptyRowFrom = props[1];
    const base = stateAt(json, emptyRowFrom + 2); // caret in the empty name

    let changed = false;
    const handled = acceptSuggestion(base, () => {
      changed = true;
    }, "tags");
    expect(handled).toBe(true);
    expect(changed).toBe(false);
  });
});

describe("acceptSuggestion", () => {
  it("accepting tags adopts the list type", () => {
    const json = v3Doc([property("", [""])]);
    const [geo] = geometry(schema.nodeFromJSON(json));
    const base = stateAt(json, geo.nameFrom);

    const next = applied(base, (dispatch) =>
      acceptSuggestion(base, dispatch, "tags"),
    );
    const prop = next.doc.content.content[1];
    expect(prop.child(0).textContent).toBe("tags");
    expect(prop.attrs.type).toBe("list");
  });

  it("rewrites the name and moves the caret into the first value", () => {
    const json = v3Doc([property("de", [""])]);
    const [geo] = geometry(schema.nodeFromJSON(json));
    // Caret at the end of the typed prefix "de".
    const base = stateAt(json, geo.nameFrom + 2);

    const next = applied(base, (dispatch) =>
      acceptSuggestion(base, dispatch, "description"),
    );

    const prop = next.doc.content.content[1];
    expect(prop.child(0).textContent).toBe("description");
    const loc = stateProperty(next)!;
    expect(loc.inName).toBe(false);
    expect(loc.valueIndex).toBe(0);
  });
});

describe("sanitizePropertyValues (storage boundary)", () => {
  const prop = (
    name: string,
    values: JSONContent[][],
    type: "text" | "list" = "list",
  ): JSONContent => ({
    type: "noteProperty",
    attrs: { type },
    content: [
      { type: "notePropertyName", content: [{ type: "text", text: name }] },
      ...values.map((inline) => ({ type: "notePropertyValue", content: inline })),
    ],
  });

  const doc = (props: JSONContent[]): JSONContent => ({
    type: "noteDoc",
    content: [
      { type: "noteTitle", content: [{ type: "text", text: "Cover" }] },
      ...props,
      { type: "paragraph" },
    ],
  });

  const valueCount = (row: JSONContent | undefined): number =>
    (row?.content ?? []).filter((n) => n.type === "notePropertyValue").length;

  it("strips empty draft values from List rows, keeps committed ones", () => {
    const source = doc([
      prop("tags", [[{ type: "text", text: "one" }], []]),
    ]);
    const out = sanitizePropertyValues(source);
    expect(valueCount(out.content?.[1])).toBe(1);
  });

  it("keeps a Text row's empty value — the still-empty field, not a draft", () => {
    const source = doc([prop("status", [[]], "text")]);
    const out = sanitizePropertyValues(source);
    expect(valueCount(out.content?.[1])).toBe(1);
  });

  it("returns the same reference when there is nothing to strip", () => {
    const source = doc([
      prop("tags", [[{ type: "text", text: "one" }]]),
    ]);
    expect(sanitizePropertyValues(source)).toBe(source);
  });
});

describe("sanitizePropertyValues (tag validity at the storage boundary)", () => {
  const prop = (
    name: string,
    values: JSONContent[][],
    type: "text" | "list" = "list",
  ): JSONContent => ({
    type: "noteProperty",
    attrs: { type },
    content: [
      { type: "notePropertyName", content: [{ type: "text", text: name }] },
      ...values.map((inline) => ({ type: "notePropertyValue", content: inline })),
    ],
  });

  const doc = (props: JSONContent[]): JSONContent => ({
    type: "noteDoc",
    content: [
      { type: "noteTitle", content: [{ type: "text", text: "Cover" }] },
      ...props,
      { type: "paragraph" },
    ],
  });

  const texts = (row: JSONContent | undefined): string[] =>
    (row?.content ?? [])
      .filter((n) => n.type === "notePropertyValue")
      .map((n) => (n.content ?? []).map((t) => t.text ?? "").join(""));

  it("reduces duplicate tags to the first occurrence", () => {
    const source = doc([
      prop("tags", [
        [{ type: "text", text: "one" }],
        [{ type: "text", text: "ONE" }],
        [{ type: "text", text: "two" }],
      ]),
    ]);
    const out = sanitizePropertyValues(source);
    expect(texts(out.content?.[1])).toEqual(["one", "two"]);
  });

  it("drops empty values alongside duplicates", () => {
    const source = doc([
      prop("tags", [[], [{ type: "text", text: "one" }], []]),
    ]);
    const out = sanitizePropertyValues(source);
    expect(texts(out.content?.[1])).toEqual(["one"]);
  });

  it("keeps a Text row's single value untouched", () => {
    const source = doc([prop("status", [[]], "text")]);
    expect(sanitizePropertyValues(source)).toBe(source);
  });
});

describe("moveProperty (the grip drag)", () => {
  const prop = (name: string, values: JSONContent[]): JSONContent => ({
    type: "noteProperty",
    attrs: { type: "text" },
    content: [
      { type: "notePropertyName", content: [{ type: "text", text: name }] },
      { type: "notePropertyValue", content: values },
    ],
  });

  const doc3 = () => ({
    type: "noteDoc" as const,
    content: [
      { type: "noteTitle", content: [{ type: "text", text: "Cover" }] },
      prop("alpha", [{ type: "text", text: "1" }]),
      prop("beta", [{ type: "text", text: "2" }]),
      prop("gamma", [{ type: "text", text: "3" }]),
      { type: "paragraph" },
    ],
  });

  function baseState() {
    return EditorState.create({ doc: schema.nodeFromJSON(doc3()) });
  }

  function names(state: EditorState): string[] {
    const out: string[] = [];
    state.doc.forEach((n) => {
      if (n.type.name === "noteProperty") out.push(n.firstChild?.textContent ?? "");
    });
    return out;
  }

  function offsets(state: EditorState): number[] {
    const out: number[] = [];
    state.doc.forEach((n, off) => {
      if (n.type.name === "noteProperty") out.push(off);
    });
    return out;
  }

  it("moves a middle row to the top with its value intact", () => {
    const state = baseState();
    const offs = offsets(state);
    const applied: { state: EditorState | null } = { state: null };
    moveProperty(state, (tr) => { applied.state = state.apply(tr); }, offs[2], offs[0]);
    expect(names(applied.state!)).toEqual(["gamma", "alpha", "beta"]);
    const gamma = applied.state!.doc.content.child(1); // the first property after the title
    expect(gamma.lastChild?.textContent).toBe("3");
  });

  it("moves the first row to the end", () => {
    const state = baseState();
    const offs = offsets(state);
    const applied: { state: EditorState | null } = { state: null };
    moveProperty(state, (tr) => { applied.state = state.apply(tr); }, offs[0], offs[2] + state.doc.nodeAt(offs[2])!.nodeSize);
    expect(names(applied.state!)).toEqual(["beta", "gamma", "alpha"]);
  });

  it("reports false for a position without a property row", () => {
    const state = baseState();
    expect(moveProperty(state, undefined, 1, 5)).toBe(false);
  });
});
