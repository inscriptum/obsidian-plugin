import { describe, expect, it } from "vitest";
import {
  buildSchemaArtifact,
  canonicalJson,
  sha256Hex,
  SCHEMA_ID,
  SCHEMA_VERSION,
  VALIDATION_CAPABILITY,
} from "./schemaArtifact";
import { getProfileSchema } from "./editorSchemas";
import { BLOCK_ID_TYPES } from "./extensions/block-ids";

/**
 * The artifact is the machine-readable schema snapshot the insum CLI
 * consumes (spec §4.7). The snapshot pins the whole shape: any node/mark/
 * content/attr change without regenerating the artifact fails here first.
 */

const schema = getProfileSchema("title");
const artifact = await buildSchemaArtifact(schema, {
  pluginVersion: "0.0.0-test",
});

describe("canonicalJson (RFC 8785 domain)", () => {
  it("sorts object keys recursively", () => {
    expect(canonicalJson({ b: 1, a: { d: 1, c: 2 } })).toBe(
      '{"a":{"c":2,"d":1},"b":1}',
    );
  });

  it("keeps array order", () => {
    expect(canonicalJson([{ z: 1 }, { a: 2 }])).toBe('[{"z":1},{"a":2}]');
  });

  it("serializes strings, numbers, booleans, null and undefined", () => {
    expect(canonicalJson("quote:\"x\"\n")).toBe('"quote:\\"x\\"\\n"');
    expect(canonicalJson(10)).toBe("10");
    expect(canonicalJson(true)).toBe("true");
    expect(canonicalJson(null)).toBe("null");
    expect(canonicalJson(undefined)).toBe("null");
  });

  it("uses UTF-16 code-unit key order", () => {
    // "A" (0x41) < "a" (0x61) < "ё" (0x0451)
    expect(canonicalJson({ "ё": 1, a: 2, A: 3 })).toBe(
      '{"A":3,"a":2,"ё":1}',
    );
  });
});

describe("sha256Hex", () => {
  it("matches the SHA-256 test vector", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("buildSchemaArtifact", () => {
  it("carries the spec §4.6/§4.7 identity fields", () => {
    expect(artifact.schema_id).toBe(SCHEMA_ID);
    expect(artifact.schema_version).toBe(SCHEMA_VERSION);
    expect(artifact.top_node).toBe("noteDoc");
    expect(artifact.validation_capability).toBe(VALIDATION_CAPABILITY);
    expect(artifact.validation_capability).toBe("partial");
    expect(artifact.schema_hash).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(artifact.id_rules).toEqual({
      attrs_key: "id",
      dom_attribute: "data-id",
      pattern: "^[a-z0-9]{8,12}$",
      recommended_length: 10,
      uniqueness: "note",
      encoding: "opaque",
    });
  });

  it("lists every node and mark of the schema", () => {
    expect(Object.keys(artifact.nodes).sort()).toEqual(
      Object.keys(schema.nodes).sort(),
    );
    expect(Object.keys(artifact.marks).sort()).toEqual(
      Object.keys(schema.marks).sort(),
    );
  });

  it("marks every block node except the top node addressable", () => {
    // The owner decision (issue block-ids ОВ-3): all block nodes carry a
    // block id; the document root does not. Compared directly with the
    // block-ids extension's list so the two cannot drift.
    expect(
      Object.entries(artifact.nodes)
        .filter(([, node]) => node.addressable)
        .map(([name]) => name)
        .sort(),
    ).toEqual([...BLOCK_ID_TYPES].sort());
    expect(artifact.nodes.noteDoc.addressable).toBe(false);
  });

  it("records content expressions and inline/searchable flags", () => {
    expect(artifact.nodes.paragraph.content).toBe("inline*");
    expect(artifact.nodes.noteDoc.content).toBe(
      "noteTitle noteProperty* (block | attachment | image)+",
    );
    expect(artifact.nodes.table.content).toBe("tableRow+");

    expect(artifact.nodes.paragraph.inline_content).toBe(true);
    expect(artifact.nodes.paragraph.searchable).toBe(true);
    expect(artifact.nodes.paragraph.top_node).toBeUndefined();
    expect(artifact.nodes.noteDoc.top_node).toBe(true);
    // Composite blocks hold no direct text: their paragraphs do.
    expect(artifact.nodes.blockquote.searchable).toBe(false);
    expect(artifact.nodes.taskItem.searchable).toBe(false);
    expect(artifact.nodes.hljsCodeBlockRow.searchable).toBe(true);
    // Leaf blocks and inline nodes are not searchable.
    expect(artifact.nodes.image.searchable).toBe(false);
    expect(artifact.nodes.text.searchable).toBe(false);
  });

  it("resolves mark rules per node type", () => {
    const allMarks = Object.keys(schema.marks).sort();
    // Unrestricted inline-content nodes allow every mark of the schema.
    expect(artifact.nodes.paragraph.marks).toEqual(allMarks);
    expect(artifact.nodes.heading.marks).toEqual(allMarks);
    // The code row restricts itself to the syntax mark.
    expect(artifact.nodes.hljsCodeBlockRow.marks).toEqual(["hljsMark"]);
    // Non-inline blocks carry no marks at all.
    expect(artifact.nodes.noteDoc.marks).toEqual([]);
    expect(artifact.nodes.blockquote.marks).toEqual([]);
    expect(artifact.nodes.table.marks).toEqual([]);
  });

  it("records attribute defaults", () => {
    expect(artifact.nodes.taskItem.attrs.checked).toEqual({ default: false });
    expect(artifact.nodes.heading.attrs.level).toEqual({ default: 1 });
    expect(artifact.nodes.tableCell.attrs.colspan).toEqual({ default: 1 });
    // A schema default of undefined is serialized as null.
    expect(artifact.nodes.image.attrs.key).toEqual({ default: null });
    expect(artifact.marks.link.attrs.href).toEqual({ default: null });
  });

  it("generates a valid example per node type where safe", () => {
    expect(artifact.nodes.paragraph.example).toEqual({
      type: "paragraph",
      // align (issues/text-align) joined attrs.id as the global attrs.
      attrs: { id: null, align: null },
    });
    expect(artifact.nodes.text.example).toBeNull();
    for (const [name, node] of Object.entries(artifact.nodes)) {
      if (node.example == null) continue;
      // The example must be a fully valid node of the very same schema:
      // fromJSON only checks names, check() validates content
      // expressions and attrs against the spec.
      expect(() => {
        const parsed = schema.nodeFromJSON(node.example);
        parsed.check();
      }, name).not.toThrow();
    }
  });

  it("is deterministic across builds", async () => {
    const again = await buildSchemaArtifact(schema, {
      pluginVersion: "0.0.0-test",
    });
    expect(canonicalJson(again)).toBe(canonicalJson(artifact));
    expect(again.schema_hash).toBe(artifact.schema_hash);
  });

  it("hashes the canonical artifact without hash and plugin version", async () => {
    const input: Record<string, unknown> = { ...artifact };
    delete input.schema_hash;
    delete input.plugin_version;
    expect(artifact.schema_hash).toBe(
      `sha256:${await sha256Hex(canonicalJson(input))}`,
    );
    // The plugin version is deliberately outside the fingerprint: the
    // schema hash must stay stable across releases with unchanged schema.
    const nextVersion = await buildSchemaArtifact(schema, {
      pluginVersion: "9.9.9",
    });
    expect(nextVersion.plugin_version).toBe("9.9.9");
    expect(nextVersion.schema_hash).toBe(artifact.schema_hash);
  });

  it("hash survives a JSON round trip (the CLI verification path)", async () => {
    // The CLI recomputes the hash from the file's JSON — undefined values
    // must not exist anywhere, or JSON.stringify would drop them and the
    // recomputation would diverge.
    const serialized = JSON.stringify(artifact);
    expect(serialized).not.toContain("undefined");
    const fromFile = JSON.parse(serialized) as Record<string, unknown>;
    const recorded = fromFile.schema_hash;
    delete fromFile.schema_hash;
    delete fromFile.plugin_version;
    expect(recorded).toBe(
      `sha256:${await sha256Hex(canonicalJson(fromFile))}`,
    );
  });

  it("matches the pinned snapshot", () => {
    expect(artifact).toMatchSnapshot();
  });
});
