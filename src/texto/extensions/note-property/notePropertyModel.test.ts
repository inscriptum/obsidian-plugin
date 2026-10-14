import { describe, expect, it } from "vitest";
import { EditorState, TextSelection } from "prosemirror-state";
import type { Node as PMNode } from "prosemirror-model";
import { getProfileSchema } from "../../editorSchemas";
import type { JSONContent } from "../../core/@types";
import {
  PROPERTY_NAME_PRESETS,
  acceptSuggestion,
  insertProperty,
  isPresetName,
  presetType,
  propertyInsertPos,
  removeProperty,
  propertyKeyDown,
  selectionProperty,
  stateProperty,
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

  it("Enter in a Text value fixes the content: no structural change", () => {
    const json = v3Doc([property("description", ["first"])]);
    const doc = schema.nodeFromJSON(json);
    const [geo] = geometry(doc);
    const base = stateAt(json, geo.values[0] + 1);

    let next: EditorState | null = null;
    const handled = propertyKeyDown(base, "Enter", null, (tr) => {
      next = base.apply(tr);
    });
    expect(handled).toBe(true);
    // The command itself dispatches nothing: the value stays as it is.
    expect(next).toBeNull();
    const prop = base.doc.content.content[1];
    expect(prop.attrs.type).toBe("text");
    expect(prop.childCount).toBe(2); // name + one value
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

  it("Backspace in an empty extra value removes just that row", () => {
    const json = v3Doc([property("tags", ["one", ""], "list")]);
    const [geo] = geometry(schema.nodeFromJSON(json));
    const base = stateAt(json, geo.values[1]);

    const next = applied(base, (dispatch) =>
      propertyKeyDown(base, "Backspace", null, dispatch),
    );
    const prop = next.doc.content.content[1];
    expect(prop.childCount).toBe(2); // name + one value
    expect(prop.child(1).textContent).toBe("one");
    const loc = stateProperty(next)!;
    expect(loc.valueIndex).toBe(0);
  });

  it("Backspace in an empty FIRST value of a list removes it and keeps the caret in the row", () => {
    const json = v3Doc([property("tags", ["", "two"], "list")]);
    const [geo] = geometry(schema.nodeFromJSON(json));
    const base = stateAt(json, geo.values[0]);

    const next = applied(base, (dispatch) =>
      propertyKeyDown(base, "Backspace", null, dispatch),
    );
    const prop = next.doc.content.content[1];
    expect(prop.childCount).toBe(2); // name + "two"
    expect(prop.child(1).textContent).toBe("two");
    const loc = stateProperty(next)!;
    expect(loc.valueIndex).toBe(0);
  });

  it("Backspace at the start of a non-empty name is swallowed without changes", () => {
    const json = v3Doc([property("description", [""])]);
    const [geo] = geometry(schema.nodeFromJSON(json));
    const base = stateAt(json, geo.nameFrom);

    let changed = false;
    const handled = propertyKeyDown(base, "Backspace", null, () => {
      changed = true;
    });
    expect(handled).toBe(true);
    expect(changed).toBe(false);
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
