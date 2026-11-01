import { describe, it, expect, afterEach, vi } from "vitest";
import { Editor } from "../../core/Editor";
import type { JSONContent } from "../../core/@types";
import { getExtensions } from "../../getExtensions";
import { NodeSelection } from "prosemirror-state";
import { Fragment, Slice } from "prosemirror-model";
import { buildSchema } from "../../../../tests/helpers/buildSchema";
import { createDocument } from "../../core/helpers/createDocument";
import { generateHTML } from "../../core/helpers/generateHTML";
import { getExportExtensions } from "../../../export/extensions";
import { findDraggableBlock, performBlockMove } from "../drag-handle/dragHandlePlugin";

import {
  assignBlockIds,
  ensureUniqueBlockIds,
  reassignBlockIds,
} from "./assignBlockIds";
import { BLOCK_IDS_EXTERNAL_CONTENT } from "./plugins/blockIds.plugin";
import {
  generateBlockId,
  generateBlockIdAvoiding,
  isBlockId,
} from "./generateBlockId";
import { isBlockIdType } from "./blockIdAttrs";

// ── fixtures ───────────────────────────────────────────────────────────────

const editors: Editor[] = [];

function createEditor(content: JSONContent): Editor {
  const element = createDiv();
  document.body.appendChild(element);
  const editor = new Editor({
    element,
    content,
    extensions: getExtensions(),
    editable: true,
  });
  editors.push(editor);
  return editor;
}

/** Asserts the value is a grammar-valid id and returns it typed. */
function expectId(id: unknown): string {
  expect(isBlockId(id)).toBe(true);
  return id as string;
}

afterEach(() => {
  for (const editor of editors.splice(0)) {
    editor.destroy();
    editor.options.element.remove();
  }
});

function p(text: string, id?: string): JSONContent {
  return {
    type: "paragraph",
    ...(id != null ? { attrs: { id } } : {}),
    content: text.length > 0 ? [{ type: "text", text }] : undefined,
  };
}

function legacyDoc(): JSONContent {
  return {
    type: "noteDoc",
    content: [
      { type: "noteTitle", content: [{ type: "text", text: "Title" }] },
      p("one"),
      p("two"),
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [p("item")],
          },
        ],
      },
      {
        type: "table",
        attrs: { data: { rowsCount: 1, colsCount: 1 } },
        content: [
          {
            type: "tableRow",
            content: [
              {
                type: "tableCell",
                content: [p("cell")],
              },
            ],
          },
        ],
      },
    ],
  };
}

/** Doc where every addressable block already carries an id (post-load). */
function idedDoc(): JSONContent {
  return {
    type: "noteDoc",
    content: [
      { type: "noteTitle", attrs: { id: "aaaaaaaaaa" }, content: [{ type: "text", text: "Title" }] },
      p("one", "bbbbbbbbbb"),
      p("two", "cccccccccc"),
    ],
  };
}

interface WithId {
  id?: string | null;
}

function idAt(doc: JSONContent, path: number[]): string | null | undefined {
  let node: JSONContent | undefined = doc;
  for (const index of path) {
    node = node.content?.[index];
    if (node == null) return undefined;
  }
  return (node.attrs as WithId | undefined)?.id;
}

function editorIds(editor: Editor): Array<{ name: string; id: string | null; pos: number }> {
  const out: Array<{ name: string; id: string | null; pos: number }> = [];
  editor.state.doc.descendants((node, pos) => {
    const id = (node.attrs as WithId).id;
    if (id != null) out.push({ name: node.type.name, id, pos });
    return true;
  });
  return out;
}

function blockPositions(editor: Editor): number[] {
  const out: number[] = [];
  editor.state.doc.forEach((_, offset) => out.push(offset));
  return out;
}

// ── generator & grammar (spec §4.4) ───────────────────────────────────────

describe("block id generator", () => {
  it("produces ids matching the spec grammar (length 10, [a-z0-9])", () => {
    for (let i = 0; i < 200; i += 1) {
      expect(isBlockId(generateBlockId())).toBe(true);
    }
  });

  it("does not repeat ids across many samples", () => {
    const used = new Set<string>();
    for (let i = 0; i < 1000; i += 1) used.add(generateBlockId());
    expect(used.size).toBe(1000);
  });

  it("avoids a provided collision set", () => {
    const used = new Set<string>("aaaaaaaaaa");
    expect(generateBlockIdAvoiding(used)).not.toBe("aaaaaaaaaa");
  });

  it("validates the grammar boundaries", () => {
    expect(isBlockId("abcdefgh")).toBe(true); // 8
    expect(isBlockId("abcdefghijkl")).toBe(true); // 12
    expect(isBlockId("abcdefg")).toBe(false); // 7
    expect(isBlockId("abcdefghijklm")).toBe(false); // 13
    expect(isBlockId("ABCDEFGH")).toBe(false);
    expect(isBlockId("abcdefgh-")).toBe(false);
    expect(isBlockId(null)).toBe(false);
    expect(isBlockId(undefined)).toBe(false);
  });
});

// ── load-time assignment (JSON path) ──────────────────────────────────────

describe("assignBlockIds", () => {
  it("tags every addressable block of a legacy document, nested included", () => {
    const tagged = assignBlockIds(legacyDoc());
    const ids: string[] = [];
    const walk = (node: JSONContent): void => {
      if (node.type != null && isBlockIdType(node.type)) {
        ids.push(expectId((node.attrs as WithId | undefined)?.id));
      }
      node.content?.forEach(walk);
    };
    walk(tagged);
    // noteTitle + 2 paragraphs + bulletList + listItem + its paragraph
    // + table + tableRow + tableCell + its paragraph
    expect(ids.length).toBe(10);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps existing valid ids and only fills the gaps", () => {
    const tagged = assignBlockIds(idedDoc());
    expect(idAt(tagged, [0])).toBe("aaaaaaaaaa");
    expect(idAt(tagged, [1])).toBe("bbbbbbbbbb");
    expect(idAt(tagged, [2])).toBe("cccccccccc");
  });

  it("does not mutate the input document", () => {
    const doc = legacyDoc();
    const snapshot = JSON.stringify(doc);
    assignBlockIds(doc);
    expect(JSON.stringify(doc)).toBe(snapshot);
  });

  it("is idempotent", () => {
    const once = assignBlockIds(legacyDoc());
    const twice = assignBlockIds(once);
    expect(twice).toEqual(once);
  });
});

// ── DOM projection ─────────────────────────────────────────────────────────

describe("block id DOM projection", () => {
  it("renders data-id (not id) onto block elements", () => {
    const editor = createEditor(assignBlockIds(legacyDoc()));
    const el = editor.view.dom.querySelector("p[data-id]");
    expect(el).not.toBeNull();
    expect(isBlockId(el?.getAttribute("data-id"))).toBe(true);
    expect(el?.hasAttribute("id")).toBe(false);
  });
});

// ── lifecycle (spec §4.5) ──────────────────────────────────────────────────

describe("block id lifecycle", () => {
  it("keeps ids on text edits and assigns none for pure typing", () => {
    const editor = createEditor(idedDoc());
    const before = editorIds(editor).map((e) => e.id);
    const pos = blockPositions(editor)[1] + 2; // inside "one"
    editor.view.dispatch(editor.state.tr.insertText("X", pos));
    expect(editorIds(editor).map((e) => e.id)).toEqual(before);
    expect(editor.state.doc.textContent).toContain("oXne");
  });

  it("keeps ids when node attrs change (task item check toggle)", () => {
    const editor = createEditor({
      type: "noteDoc",
      content: [
        { type: "noteTitle", content: [{ type: "text", text: "T" }] },
        {
          type: "taskList",
          content: [
            {
              type: "taskItem",
              attrs: { checked: false, id: "dddddddddd" },
              content: [p("todo")],
            },
          ],
        },
      ],
    });
    const taskPos = blockPositions(editor)[1];
    editor.view.dispatch(editor.state.tr.setNodeMarkup(taskPos, null, { checked: true }));
    expect(editorIds(editor).find((e) => e.name === "taskItem")?.id).toBe("dddddddddd");
  });

  it("split: the first part keeps the original id, the second gets a fresh one", () => {
    const editor = createEditor(idedDoc());
    const pos = blockPositions(editor)[1] + 2; // inside "one"
    editor.view.dispatch(editor.state.tr.split(pos));
    const paragraphs = editorIds(editor).filter((entry) => entry.name === "paragraph");
    // "one" split into two + "two" untouched.
    expect(paragraphs).toHaveLength(3);
    expect(paragraphs[0]?.id).toBe("bbbbbbbbbb");
    expect(isBlockId(paragraphs[1]?.id)).toBe(true);
    expect(paragraphs[1]?.id).not.toBe("bbbbbbbbbb");
    expect(paragraphs[2]?.id).toBe("cccccccccc");
  });

  it("join: the merged paragraph keeps the left id", () => {
    const editor = createEditor(idedDoc());
    const positions = blockPositions(editor);
    // Join the two paragraphs at their boundary: the merged block keeps
    // the left id (spec §4.5 join rule).
    editor.view.dispatch(editor.state.tr.join(positions[2], 1));
    const paragraphs = editorIds(editor).filter((e) => e.name === "paragraph");
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]?.id).toBe("bbbbbbbbbb");
    expect(editor.state.doc.textContent).toContain("onetwo");
  });

  it("an inserted twin block does not steal its neighbor's id", () => {
    // A batch that INSERTS id-less content identical to a surviving
    // neighbor must not recover the neighbor's id into the insert (the
    // recovery is reserved for nodes the batch consumed — review round 2).
    const editor = createEditor(idedDoc());
    const positions = blockPositions(editor);
    const twin = editor.state.schema.nodes.paragraph.create(null, [
      editor.state.schema.text("one"),
    ]);
    editor.view.dispatch(editor.state.tr.insert(positions[1], twin));

    const paragraphs = editorIds(editor).filter((e) => e.name === "paragraph");
    expect(paragraphs).toHaveLength(3);
    const ids = paragraphs.map((e) => e.id);
    expect(new Set(ids).size).toBe(3);
    expect(ids).toContain("bbbbbbbbbb");
  });

  it("paste: the pasted copy gets fresh ids, the source keeps its id", () => {
    const editor = createEditor(idedDoc());
    const positions = blockPositions(editor);
    const source = editor.state.doc.nodeAt(positions[1])!;
    const slice = editor.state.doc.slice(positions[1], positions[1] + source.nodeSize);
    // Paste after the last block — the same replace shape PM's paste uses.
    const end = editor.state.doc.content.size - 1;
    editor.view.dispatch(editor.state.tr.replace(end, end, slice));

    const paragraphs = editorIds(editor).filter((e) => e.name === "paragraph");
    expect(paragraphs).toHaveLength(3);
    // Document order: one (source), two (source), pasted copy of "one".
    expect(paragraphs[0]?.id).toBe("bbbbbbbbbb");
    expect(paragraphs[1]?.id).toBe("cccccccccc");
    expect(isBlockId(paragraphs[2]?.id)).toBe(true);
    expect(paragraphs[2]?.id).not.toBe("bbbbbbbbbb");
  });

  it("paste over a node with the SAME text: no id inheritance either way", () => {
    // Review CR-24 (author's answer): the pasted copy carries the source's
    // id, the replaced target carries its own — neither survives. The spec
    // §4.5 paste rule (fresh ids for the copy) wins over the §4.4 replace
    // rule (keep the root target's id) for EDITOR pastes.
    const editor = createEditor(idedDoc());
    const positions = blockPositions(editor);
    // Replace paragraph "two" (cccccccccc) with a SAME-TEXT paragraph
    // carrying a different id (as if pasted from elsewhere in the note).
    const sameText = editor.state.schema.nodes.paragraph.create(
      { id: "dddddddddd" },
      [editor.state.schema.text("two")],
    );
    const slice = new Slice(Fragment.from(sameText), 0, 0);
    editor.view.dispatch(
      editor.state.tr.replace(positions[2], positions[2] + 5, slice),
    );
    const paragraphs = editorIds(editor).filter((e) => e.name === "paragraph");
    expect(paragraphs).toHaveLength(2);
    const id = paragraphs[1]?.id;
    expect(id).not.toBe("cccccccccc"); // target id is gone
    expect(id).not.toBe("dddddddddd"); // and the arriving id was re-id'd
  });

  it("paste from another note: fresh ids in the target (spec §4.5)", () => {
    const editor = createEditor(idedDoc());
    // A real cross-note paste re-parses the clipboard HTML into the target
    // schema (parseHTML restores data-id), so the arriving slice carries the
    // source note's id in the target schema — simulated via nodeFromJSON.
    const foreignParagraph = editor.state.schema.nodeFromJSON(p("foreign", "zzzzzzzzzz"));
    const slice = new Slice(Fragment.from(foreignParagraph), 0, 0);

    const end = editor.state.doc.content.size;
    editor.view.dispatch(editor.state.tr.replace(end, end, slice));

    const ids = editorIds(editor).map((e) => e.id);
    expect(ids).not.toContain("zzzzzzzzzz");
    // The pasted copy was tagged with a fresh id instead.
    expect(ids.filter((id) => id !== null && isBlockId(id)).length).toBe(4);
  });

  it("duplicate-shaped insert next to the source re-ids the copy", () => {
    const editor = createEditor(idedDoc());
    const positions = blockPositions(editor);
    const source = editor.state.doc.nodeAt(positions[1])!;
    const slice = editor.state.doc.slice(positions[1], positions[1] + source.nodeSize);
    const afterSource = positions[1] + source.nodeSize;
    editor.view.dispatch(editor.state.tr.replace(afterSource, afterSource, slice));

    const paragraphs = editorIds(editor).filter((e) => e.name === "paragraph");
    expect(paragraphs).toHaveLength(3);
    expect(paragraphs[0]?.id).toBe("bbbbbbbbbb");
    expect(paragraphs[1]?.id).not.toBe("bbbbbbbbbb");
  });

  it("move (drag-handle block move) keeps the id", () => {
    const editor = createEditor(assignBlockIds(legacyDoc()));
    const doc = editor.state.doc;
    const positions = blockPositions(editor);
    const moved = doc.nodeAt(positions[1])!;
    const id = (moved.attrs as WithId).id;
    const block = findDraggableBlock(doc, positions[1] + 1)!;

    expect(performBlockMove(editor.view, block, positions[3])).toBe(true);

    const after = editor.state.doc;
    const found: string[] = [];
    after.descendants((node) => {
      if (node.textContent === "one" && node.type.name === "paragraph") {
        found.push((node.attrs as WithId).id as string);
      }
      return true;
    });
    expect(found).toEqual([id]);
  });

  it("undo restores previous ids; redo returns the same ones", () => {
    const editor = createEditor(idedDoc());
    const pos = blockPositions(editor)[1] + 2;
    editor.view.dispatch(editor.state.tr.split(pos));
    const afterSplit = editorIds(editor);
    const firstParagraphPos = afterSplit.find((e) => e.name === "paragraph")?.pos;
    const secondId = afterSplit.find((e) => e.name === "paragraph" && e.id !== "bbbbbbbbbb")?.id;
    expect(isBlockId(secondId)).toBe(true);

    editor.commands.undo();
    const afterUndo = editorIds(editor);
    expect(afterUndo.find((e) => e.name === "paragraph")?.id).toBe("bbbbbbbbbb");
    expect(afterUndo.some((e) => e.id === secondId)).toBe(false);

    editor.commands.redo();
    const afterRedo = editorIds(editor);
    expect(
      afterRedo.find((e) => e.name === "paragraph" && e.pos !== firstParagraphPos)?.id,
    ).toBe(secondId);
  });

  it("history replays the assignments with the edit (typing after split)", () => {
    const editor = createEditor(idedDoc());
    const positions = blockPositions(editor);
    editor.view.dispatch(editor.state.tr.split(positions[1] + 2));
    editor.view.dispatch(editor.state.tr.insertText("hello", positions[1] + 2));
    const after = editorIds(editor).map((e) => e.id);

    // History groups the adjacent split+typing into one event; one undo
    // must restore the pre-split ids verbatim.
    editor.commands.undo();
    expect(editorIds(editor).map((e) => e.id)).toEqual([
      "aaaaaaaaaa",
      "bbbbbbbbbb",
      "cccccccccc",
    ]);

    editor.commands.redo();
    expect(editorIds(editor).map((e) => e.id)).toEqual(after);
  });
});


describe("collision regeneration (spec §4.4)", () => {
  it("regenerates when the first candidate is already in use", () => {
    // Deterministic stub: the first candidate comes out as "aaaaaaaaaa"
    // (letter a = index 10 of the alphabet), which the caller already uses;
    // the generator must notice the collision and emit the second
    // candidate instead of returning a duplicate.
    let call = 0;
    const stub = vi
      .spyOn(crypto, "getRandomValues")
      .mockImplementation((buf: ArrayBufferView) => {
        const bytes = buf as Uint8Array;
        call += 1;
        bytes.fill(call === 1 ? 10 : 11); // 11 → "bbbbbbbbbb"
        return buf;
      });
    try {
      const id = generateBlockIdAvoiding(new Set(["aaaaaaaaaa"]));
      expect(id).toBe("bbbbbbbbbb");
      expect(call).toBeGreaterThanOrEqual(2);
    } finally {
      stub.mockRestore();
    }
  });
});

// ── whole-note copies (duplicated pages) ───────────────────────────────────

describe("reassignBlockIds", () => {
  it("replaces every id with fresh, disjoint ones", () => {
    const source = assignBlockIds(legacyDoc());
    const copy = reassignBlockIds(source);
    const sourceIds: string[] = [];
    const copyIds: string[] = [];
    const walk = (node: JSONContent, out: string[]): void => {
      const id = (node.attrs as WithId | undefined)?.id;
      if (typeof id === "string") out.push(id);
      node.content?.forEach((child) => walk(child, out));
    };
    walk(source, sourceIds);
    walk(copy, copyIds);
    expect(copyIds.length).toBe(sourceIds.length);
    expect(new Set(copyIds).size).toBe(copyIds.length);
    for (const id of copyIds) expect(sourceIds).not.toContain(id);
  });
});

// ── grammar on parse and in the save net ───────────────────────────────────

describe("id grammar enforcement", () => {
  it("parseHTML drops data-id values that violate the grammar", () => {
    const editor = createEditor(
      '<p data-id="NOT-VALID!">from html</p>' as unknown as JSONContent,
    );
    const first = editor.state.doc.nodeAt(1);
    expect((first?.attrs as WithId).id ?? null).toBeNull();
  });

  it("the save net re-ids grammar-invalid values like missing ids", () => {
    const editor = createEditor({
      type: "noteDoc",
      content: [
        { type: "noteTitle", content: [{ type: "text", text: "T" }] },
        p("a", "BAD-ID!"),
        p("b", "BAD-ID!"),
      ],
    });
    const fix = ensureUniqueBlockIds(editor);
    expect(fix.fixed).toBe(true);
    const paragraphs = editorIds(editor).filter((e) => e.name === "paragraph");
    expect(isBlockId(paragraphs[0]?.id)).toBe(true);
    expect(isBlockId(paragraphs[1]?.id)).toBe(true);
    expect(paragraphs[0]?.id).not.toBe(paragraphs[1]?.id);
  });
});

// ── external content replacement (CR-01) ───────────────────────────────────

describe("external content replacement", () => {
  const incoming = {
    type: "noteDoc",
    content: [
      {
        type: "noteTitle",
        attrs: { id: "deadbeef01" },
        content: [{ type: "text", text: "Synced" }],
      },
      p("synced paragraph", "deadbeef02"),
    ],
  };

  it("setContent tagged external keeps the arriving ids verbatim", () => {
    const editor = createEditor(idedDoc());
    editor.commands.setContent(incoming, false, {}, {
      [BLOCK_IDS_EXTERNAL_CONTENT]: true,
    });
    const ids = editorIds(editor).map((e) => e.id);
    expect(ids).toContain("deadbeef01");
    expect(ids).toContain("deadbeef02");
  });

  it("an untagged whole-document replace re-ids the arriving ids (copy rule)", () => {
    const editor = createEditor(idedDoc());
    editor.commands.setContent(incoming);
    const ids = editorIds(editor).map((e) => e.id);
    expect(ids).not.toContain("deadbeef01");
    expect(ids).not.toContain("deadbeef02");
    for (const id of ids) expect(isBlockId(id)).toBe(true);
  });
});

// ── partial attrs-replace keeps the id (CR-02) ─────────────────────────────

describe("partial setNodeMarkup keeps ids", () => {
  it("code-block language switch preserves the id", () => {
    const doc = {
      type: "noteDoc",
      content: [
        { type: "noteTitle", content: [{ type: "text", text: "T" }] },
        {
          type: "hljsCodeBlock",
          attrs: { class: "language-js" },
          content: [
            {
              type: "hljsCodeBlockRow",
              content: [{ type: "text", text: "const a = 1;" }],
            },
          ],
        },
      ],
    };
    const editor = createEditor(assignBlockIds(doc));
    const blockPos = blockPositions(editor)[1];
    const idBefore = (editor.state.doc.nodeAt(blockPos)?.attrs as WithId).id;

    // The exact production shape (hljsCodeBlock.ts): a partial attrs object
    // without a spread — PM's setNodeMarkup REPLACES the whole attrs object.
    editor.view.dispatch(
      editor.state.tr.setNodeMarkup(blockPos, undefined, {
        class: "language-python",
      }),
    );

    const node = editor.state.doc.nodeAt(blockPos);
    expect(node?.attrs.class).toBe("language-python");
    expect((node?.attrs as WithId).id).toBe(idBefore);
  });

  it("image src resync preserves the id", () => {
    // The image is mounted like the smoke fixture does (no state) — the
    // real resync then ADDS state through the same partial setNodeMarkup
    // shape imageOnSetViewProps uses: {data, state} without a spread.
    const doc = {
      type: "noteDoc",
      content: [
        { type: "noteTitle", content: [{ type: "text", text: "T" }] },
        {
          type: "image",
          attrs: {
            data: { id: "assets/pic.png", size: "70", filename: "pic.png" },
          },
        },
      ],
    };
    const editor = createEditor(assignBlockIds(doc));
    const imgPos = blockPositions(editor)[1];
    const idBefore = (editor.state.doc.nodeAt(imgPos)?.attrs as WithId).id;
    expect(typeof idBefore).toBe("string");

    // The image NodeView cannot mount under jsdom (gfc custom element),
    // so the batch goes through EditorState.apply — appendTransaction runs
    // identically without a view.
    const after = editor.state.apply(
      editor.state.tr.setNodeMarkup(imgPos, undefined, {
        data: { id: "assets/pic.png", size: "70", filename: "pic.png" },
        state: { src: "app://new/pic.png" },
      }),
    );

    const node = after.doc.nodeAt(imgPos);
    expect((node?.attrs as { state?: { src?: string } }).state?.src).toBe(
      "app://new/pic.png",
    );
    expect((node?.attrs as WithId).id).toBe(idBefore);
  });
});

// ── media data-id namespace (CR-03) ────────────────────────────────────────

describe("media data-id namespace", () => {
  function imageDoc(): JSONContent {
    return {
      type: "noteDoc",
      content: [
        { type: "noteTitle", content: [{ type: "text", text: "T" }] },
        {
          type: "image",
          attrs: {
            data: { id: "assets/pic.png", size: "70", filename: "pic.png" },
          },
        },
      ],
    };
  }

  it("renders data-src for the media path and data-id for the block id", () => {
    const editor = createEditor(assignBlockIds(imageDoc()));
    const el = editor.view.dom.querySelector("texto-extension-image");
    expect(el).not.toBeNull();
    const mediaPath = el?.getAttribute("data-src");
    const blockId = el?.getAttribute("data-id");
    expect(mediaPath).toBe("assets/pic.png");
    expect(isBlockId(blockId)).toBe(true);
    expect(blockId).not.toBe(mediaPath);
  });

  it("HTML round-trip restores both the media path and the block id", () => {
    const tagged = assignBlockIds(imageDoc());
    const html = generateHTML(tagged, getExportExtensions());
    const editor = createEditor(html as unknown as JSONContent);
    const img = editor.state.doc.nodeAt(blockPositions(editor)[1]);
    const data = (img?.attrs as { data?: { id?: string } }).data;
    expect(data?.id).toBe("assets/pic.png");
    expect(isBlockId((img?.attrs as WithId).id)).toBe(true);
  });

  it("a placeholder image's block id in data-id is NOT read as a vault path", () => {
    // A placeholder image (no data.id) renders its block id as data-id and
    // no data-src at all — parsing that HTML back must not persist the
    // block id as the media path ("File not found" round-trip, CR-22).
    const doc = createDocument(
      '<p>intro</p><texto-extension-image data-id="b1a2c3d4e5"></texto-extension-image>',
      buildSchema(),
      {},
    );
    const img = doc.content.child(1);
    expect(img.type.name).toBe("image");
    expect((img.attrs as { data?: { id?: string | null } }).data?.id ?? null).toBeNull();
  });

  it("legacy clipboard HTML (data-id as media path) still parses", () => {
    // Parsed through the schema directly (the image NodeView cannot mount
    // under jsdom) — this is exactly what PM's HTML clipboard parse runs.
    const doc = createDocument(
      '<p>intro</p><texto-extension-image data-id="assets/old.png"></texto-extension-image>',
      buildSchema(),
      {},
    );
    const img = doc.content.child(1);
    expect(img.type.name).toBe("image");
    expect((img?.attrs as { data?: { id?: string } }).data?.id).toBe(
      "assets/old.png",
    );
  });
});

// ── save-path duplicate net ────────────────────────────────────────────────

describe("ensureUniqueBlockIds", () => {
  it("re-ids later duplicates, keeping the first in document order", () => {
    const editor = createEditor({
      type: "noteDoc",
      content: [
        { type: "noteTitle", content: [{ type: "text", text: "T" }] },
        p("a", "deadbeef01"),
        p("b", "deadbeef01"),
        p("c", "deadbeef01"),
      ],
    });
    // The editor does not run the net on its own: a document arriving with
    // duplicates keeps them until the save path calls the guard.
    expect(editorIds(editor).filter((e) => e.id === "deadbeef01")).toHaveLength(3);

    const fix = ensureUniqueBlockIds(editor);
    expect(fix.fixed).toBe(true);
    expect(fix.replaced).toEqual(["deadbeef01", "deadbeef01"]);

    const paragraphs = editorIds(editor).filter((e) => e.name === "paragraph");
    expect(paragraphs[0]?.id).toBe("deadbeef01");
    expect(isBlockId(paragraphs[1]?.id)).toBe(true);
    expect(isBlockId(paragraphs[2]?.id)).toBe(true);
    expect(paragraphs[1]?.id).not.toBe(paragraphs[2]?.id);
  });

  it("is a no-op on a clean document", () => {
    const editor = createEditor(idedDoc());
    expect(ensureUniqueBlockIds(editor)).toEqual({
      fixed: false,
      replaced: [],
      filled: 0,
    });
  });

  it("does not pollute undo history", () => {
    const editor = createEditor({
      type: "noteDoc",
      content: [
        { type: "noteTitle", content: [{ type: "text", text: "T" }] },
        p("a", "deadbeef01"),
        p("b", "deadbeef01"),
      ],
    });
    const textBefore = editor.state.doc.textContent;
    ensureUniqueBlockIds(editor);
    expect(editor.state.doc.textContent).toBe(textBefore);
    // Nothing undoable: the fix is a storage repair, not an edit.
    expect(editor.commands.undo()).toBe(false);
  });
});

// ── serialization round-trip ───────────────────────────────────────────────

describe("block id serialization", () => {
  it("survives Node.fromJSON round-trips (schema declares attrs.id)", () => {
    const editor = createEditor(assignBlockIds(legacyDoc()));
    const json = editor.state.doc.toJSON() as JSONContent;
    const schema = buildSchema();
    const reparsed = schema.nodeFromJSON(json).toJSON() as JSONContent;
    expect(reparsed).toEqual(json);
  });

  it("export schema keeps attrs.id and renders data-id", () => {
    const tagged = assignBlockIds(legacyDoc());
    const html = generateHTML(tagged, getExportExtensions());
    expect(html).toContain("data-id=");
    expect(html).toContain(`data-id="${expectId(idAt(tagged, [1]))}"`);
  });

  it("documents without ids export without data-id", () => {
    const html = generateHTML(legacyDoc(), getExportExtensions());
    expect(html).not.toContain("data-id");
  });
});

  it("paste over a non-empty selection: replaced ids are gone, the copy is fresh", () => {
    const editor = createEditor(idedDoc());
    const positions = blockPositions(editor);
    // Replace paragraph "two" (cccccccccc) with a copy of "one" (bbbbbbbbbb):
    // the arriving id is cancelled by the removed content, but the copy must
    // still be re-id'd — it duplicates the source elsewhere in the note.
    const source = editor.state.doc.nodeAt(positions[1])!;
    const slice = editor.state.doc.slice(positions[1], positions[1] + source.nodeSize);
    editor.view.dispatch(
      editor.state.tr.replace(positions[2], positions[2] + 5, slice),
    );
    const paragraphs = editorIds(editor).filter((e) => e.name === "paragraph");
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0]?.id).toBe("bbbbbbbbbb");
    expect(expectId(paragraphs[1]?.id)).not.toBe("bbbbbbbbbb");
    expect(paragraphs.map((e) => e.id)).not.toContain("cccccccccc");
  });

  it("nested paste: every addressable node of the copy gets a fresh id", () => {
    const editor = createEditor(idedDoc());
    const nested = {
      type: "noteDoc",
      content: [
        {
          type: "bulletList",
          attrs: { id: "llllllllll" },
          content: [
            {
              type: "listItem",
              attrs: { id: "iiiiiiiiii" },
              content: [p("item", "pppppppppp")],
            },
          ],
        },
      ],
    };
    const node = editor.state.schema.nodeFromJSON(
      (nested.content as JSONContent[])[0],
    );
    const slice = new Slice(Fragment.from(node), 0, 0);
    const end = editor.state.doc.content.size;
    editor.view.dispatch(editor.state.tr.replace(end, end, slice));

    const pasted: string[] = [];
    editor.state.doc.descendants((n) => {
      const id = (n.attrs as WithId).id;
      if (id != null && id !== "aaaaaaaaaa" && id !== "bbbbbbbbbb" && id !== "cccccccccc") {
        pasted.push(id);
      }
      return true;
    });
    // list + item + its paragraph — fresh, grammar-valid ids (a trailing
    // paragraph from the note-doc plugin may add one more). None of the
    // ids the copy arrived with may survive.
    expect(pasted.length).toBeGreaterThanOrEqual(3);
    for (const id of pasted) expect(isBlockId(id)).toBe(true);
    expect(new Set(pasted).size).toBe(pasted.length);
    for (const arrived of ["llllllllll", "iiiiiiiiii", "pppppppppp"]) {
      expect(pasted).not.toContain(arrived);
    }
  });

  it("undo of a paste restores the fresh ids verbatim", () => {
    const editor = createEditor(idedDoc());
    const positions = blockPositions(editor);
    const source = editor.state.doc.nodeAt(positions[1])!;
    const slice = editor.state.doc.slice(positions[1], positions[1] + source.nodeSize);
    const end = editor.state.doc.content.size;
    editor.view.dispatch(editor.state.tr.replace(end, end, slice));
    const afterPaste = editorIds(editor).map((e) => e.id);
    expect(afterPaste).toHaveLength(4);

    editor.commands.undo();
    expect(editorIds(editor).map((e) => e.id)).toEqual([
      "aaaaaaaaaa",
      "bbbbbbbbbb",
      "cccccccccc",
    ]);

    editor.commands.redo();
    expect(editorIds(editor).map((e) => e.id)).toEqual(afterPaste);
  });

  it("split at the end of a block: the new empty part is tagged too", () => {
    const editor = createEditor(idedDoc());
    const positions = blockPositions(editor);
    const endPos = positions[2] + 4; // inside "two", after the last character
    editor.view.dispatch(editor.state.tr.split(endPos));
    const paragraphs = editorIds(editor).filter((e) => e.name === "paragraph");
    expect(paragraphs).toHaveLength(3);
    expect(paragraphs[0]?.id).toBe("bbbbbbbbbb");
    expect(paragraphs[1]?.id).toBe("cccccccccc");
    // The trailing part carries default attrs (no copied id): the
    // missing-id path must tag it.
    expect(expectId(paragraphs[2]?.id)).toBeTruthy();
  });

// ── selection safety (AttrStep, not setNodeMarkup) ─────────────────────────

describe("id assignment is selection-safe", () => {
  it("a NodeSelection on a block survives its id assignment", () => {
    // The app assigns ids at load; a block can still be tagged on a later
    // edit (nodes the load path could not tag, content replaced from
    // outside). The assignment must not drop a selection anchored on it.
    const editor = createEditor(legacyDoc());
    const positions = blockPositions(editor);
    editor.view.dispatch(
      editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, positions[2])),
    );
    expect(editor.state.selection instanceof NodeSelection).toBe(true);

    // Type into the selected block — its id is assigned in the same batch.
    editor.view.dispatch(editor.state.tr.insertText("X", positions[2] + 1));

    expect(editor.state.selection instanceof NodeSelection).toBe(true);
    expect(expectId(editorIds(editor).find((e) => e.pos === positions[2])?.id)).toBeTruthy();
  });
});
