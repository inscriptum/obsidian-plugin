import { describe, expect, it } from "vitest";
import {
  getProfileExtensions,
  getProfileSchema,
  EDITOR_PROFILES,
  type EditorProfileId,
} from "./editorSchemas";

/**
 * Schema-shape guard (spec 8.6.1): the canonical shape of every profile is
 * pinned here. A change to node/mark composition or content expressions
 * without raising UM_SCHEMA_VERSION is a breaking change shipped silently —
 * this test fails first. To change a profile's schema legitimately: bump
 * the version in umSchemas/umTypes, add the migration chain entry, then
 * update the snapshot strings below.
 */

const NOTE_NODES = [
  "attachment:null",
  "blockquote:block+",
  "bulletList:listItem+",
  "hardBreak:null",
  "heading:inline*",
  "hljsCodeBlock:(hljsCodeBlockRow | paragraph?)+",
  "hljsCodeBlockRow:inline*",
  "horizontalRule:null",
  "image:null",
  "listItem:paragraph block*",
  "noteDoc:noteTitle (block | attachment | image)+",
  "noteTitle:inline*",
  "orderedList:listItem+",
  "paragraph:inline*",
  "table:tableRow+",
  "tableCell:block+",
  "tableHeader:block+",
  "tableRow:(tableCell | tableHeader)*",
  "taskItem:paragraph block*",
  "taskList:taskItem+",
  "text:null",
];

const MARKS = "bold,code,highlight,hljsMark,italic,link,strike,textStyle,underline";

function canonicalShape(profile: EditorProfileId): string {
  const schema = getProfileSchema(profile);
  const nodes = Object.entries(schema.nodes)
    .map(([name, type]) => `${name}:${type.spec.content ?? "null"}`)
    .sort();
  const marks = Object.keys(schema.marks).sort().join(",");
  const topName = schema.spec.topNode;
  if (topName !== EDITOR_PROFILES[profile].topNode) {
    return `top-node mismatch: profile says ${EDITOR_PROFILES[profile].topNode}, schema built ${topName}`;
  }
  return `top=${topName}\nnodes=${nodes.join(",")}\nmarks=${marks}`;
}

describe("editor profiles", () => {
  it("every profile builds a schema whose top node matches the spec", () => {
    for (const profile of Object.keys(EDITOR_PROFILES) as EditorProfileId[]) {
      const extensions = getProfileExtensions(profile);
      expect(extensions.length).toBeGreaterThan(0);
      const schema = getProfileSchema(profile);
      expect(schema.spec.topNode).toBe(EDITOR_PROFILES[profile].topNode);
    }
  });

  it("note profile (plain .note, v1) — title mandatory", () => {
    expect(canonicalShape("note")).toBe(
      `top=noteDoc\nnodes=${NOTE_NODES.join(",")}\nmarks=${MARKS}`,
    );
  });

  it("title profile (title-v1) — header nodes, summary mandatory", () => {
    expect(canonicalShape("title")).toBe(
      `top=noteDoc\nnodes=${[
        ...NOTE_NODES.filter((n) => !n.startsWith("noteDoc:")),
        "noteDoc:noteTitle noteSummary (block | attachment | image)+",
        "noteSummary:inline*",
      ]
        .sort()
        .join(",")}\nmarks=${MARKS}`,
    );
  });

  it("plain profile (plain-v1) — title optional (legacy pages parse)", () => {
    expect(canonicalShape("plain")).toBe(
      `top=noteDoc\nnodes=${[
        ...NOTE_NODES.filter((n) => !n.startsWith("noteDoc:")),
        "noteDoc:noteTitle? (block | attachment | image)+",
      ]
        .sort()
        .join(",")}\nmarks=${MARKS}`,
    );
  });

  it("title and plain profiles differ only in the top-node expression", () => {
    const title = getProfileSchema("title");
    const plain = getProfileSchema("plain");
    const titleNodes = Object.keys(title.nodes).sort();
    const plainNodes = Object.keys(plain.nodes).sort();
    expect(plainNodes).toEqual(titleNodes.filter((n) => n !== "noteSummary"));
    expect(title.nodes.noteDoc.spec.content).not.toBe(
      plain.nodes.noteDoc.spec.content,
    );
  });
});
