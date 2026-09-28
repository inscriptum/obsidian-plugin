import { describe, expect, it } from "vitest";
import { unzipSync, zipSync } from "fflate";
import type { JSONContent } from "../../texto/core/@types";
import { UmNotepad, noteDisplayTitle } from "./umNotepad";
import {
  inferSchemaFields,
  interpretSchema,
  migrateNoteDoc,
  runMigrationChain,
} from "./umSchemas";
import {
  UM_SCHEMA_PLAIN,
  UM_SCHEMA_TITLE,
  UM_SCHEMA_VERSION,
} from "./umTypes";

function titleDoc(title = ""): JSONContent {
  return {
    type: "noteDoc",
    content: [
      { type: "noteTitle", content: title ? [{ type: "text", text: title }] : [] },
      { type: "noteSummary" },
      { type: "paragraph" },
    ],
  };
}

function paragraphDoc(text?: string): JSONContent {
  return {
    type: "noteDoc",
    content: [
      text
        ? { type: "paragraph", content: [{ type: "text", text }] }
        : { type: "paragraph" },
    ],
  };
}

function headingDoc(text: string): JSONContent {
  return {
    type: "noteDoc",
    content: [
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text }],
      },
      { type: "paragraph" },
    ],
  };
}

describe("interpretSchema (8.6.2)", () => {
  it("infers the family when the fields are absent (legacy)", () => {
    expect(interpretSchema({ order: 0 })).toEqual({
      kind: "openable",
      family: UM_SCHEMA_TITLE,
      version: UM_SCHEMA_VERSION,
    });
    expect(interpretSchema({ order: 3 })).toEqual({
      kind: "openable",
      family: UM_SCHEMA_PLAIN,
      version: UM_SCHEMA_VERSION,
    });
  });

  it("treats a newer version of a known family as unsupported", () => {
    expect(interpretSchema({ order: 0, schema: "title", schemaVersion: 99 })).toEqual({
      kind: "unsupported",
      family: "title",
      version: 99,
    });
  });

  it("treats an unknown family exactly like a newer version", () => {
    expect(interpretSchema({ order: 1, schema: "mindmap", schemaVersion: 1 })).toEqual({
      kind: "unsupported",
      family: "mindmap",
      version: 1,
    });
    expect(interpretSchema({ order: 1, schema: "mindmap", schemaVersion: 42 })).toEqual({
      kind: "unsupported",
      family: "mindmap",
      version: 42,
    });
  });

  it("opens known families at the current version", () => {
    expect(interpretSchema({ order: 0, schema: "title", schemaVersion: 1 })).toEqual({
      kind: "openable",
      family: "title",
      version: 1,
    });
  });
});

describe("migrations (8.6.3)", () => {
  it("runs a chain in order", () => {
    const result = runMigrationChain(
      [
        (doc) => ({ ...doc, tag: 1 }),
        (doc) => ({ ...doc, tag: (doc.tag as number) + 1 }),
      ],
      { type: "doc" },
      2,
    );
    expect(result.ok).toBe(true);
    expect(result.doc).toEqual({ type: "doc", tag: 2 });
    expect(result.toVersion).toBe(2);
  });

  it("fails with the ORIGINAL doc when a step throws", () => {
    const original: JSONContent = { type: "doc" };
    const result = runMigrationChain(
      [
        (doc) => ({ ...doc, step: 1 }),
        () => {
          throw new Error("boom");
        },
      ],
      original,
      2,
    );
    expect(result.ok).toBe(false);
    expect(result.doc).toBe(original);
  });

  it("reports missing chain entries as failure, current-version docs as ok", () => {
    // v1 is current: nothing to migrate, and fromVersion >= current is
    // rejected as a misuse.
    const doc = titleDoc();
    expect(migrateNoteDoc("title", 1, doc)).toEqual({
      ok: false,
      doc,
      toVersion: 1,
    });
  });
});

describe("UmNotepad schema handling", () => {
  const ENC = new TextEncoder();
  const DEC = new TextDecoder();

  function zipContainer(
    manifest: unknown,
    notes: Record<string, JSONContent>,
  ): Uint8Array {
    const entries: Record<string, Uint8Array> = {
      "manifest.json": ENC.encode(JSON.stringify(manifest)),
    };
    for (const [path, doc] of Object.entries(notes)) {
      entries[path] = ENC.encode(JSON.stringify(doc));
    }
    return zipSync(entries);
  }

  function readManifest(bytes: Uint8Array): Record<string, unknown> {
    return JSON.parse(DEC.decode(unzipSync(bytes)["manifest.json"]));
  }

  it("stamps inferred schema fields on legacy containers and writes them back", () => {
    const bytes = zipContainer(
      {
        format: "um",
        version: 1,
        type: "notepad",
        notes: [
          { id: "a", path: "notes/a.json", order: 0 },
          { id: "b", path: "notes/b.json", order: 1 },
        ],
      },
      {
        "notes/a.json": titleDoc("Cover"),
        "notes/b.json": paragraphDoc("hello"),
      },
    );

    const nb = UmNotepad.fromBytes(bytes);
    expect(nb.note("a")?.schema).toBe(UM_SCHEMA_TITLE);
    expect(nb.note("a")?.schemaVersion).toBe(UM_SCHEMA_VERSION);
    expect(nb.note("b")?.schema).toBe(UM_SCHEMA_PLAIN);
    expect(nb.note("b")?.schemaVersion).toBe(UM_SCHEMA_VERSION);
    // Title mirrors adopted per family (header node vs first line).
    expect(nb.note("a")?.title).toBe("Cover");
    expect(nb.note("b")?.title).toBe("hello");

    const manifest = readManifest(nb.serialize());
    expect(manifest.notes).toEqual([
      expect.objectContaining({
        id: "a",
        schema: UM_SCHEMA_TITLE,
        schemaVersion: UM_SCHEMA_VERSION,
      }),
      expect.objectContaining({
        id: "b",
        schema: UM_SCHEMA_PLAIN,
        schemaVersion: UM_SCHEMA_VERSION,
      }),
    ]);
  });

  it("normalizes a legacy title page missing its summary (in memory, persists on save)", () => {
    const bytes = zipContainer(
      {
        format: "um",
        version: 1,
        type: "notepad",
        notes: [{ id: "a", path: "notes/a.json", order: 0, title: "Old" }],
      },
      {
        // Pre-summary era: noteTitle + paragraph, no noteSummary.
        "notes/a.json": {
          type: "noteDoc",
          content: [
            { type: "noteTitle", content: [{ type: "text", text: "Old" }] },
            { type: "paragraph" },
          ],
        },
      },
    );

    const nb = UmNotepad.fromBytes(bytes);
    expect(nb.isNoteOpenable("a")).toBe(true);
    expect(nb.noteContent("a")?.content?.map((n) => n.type)).toEqual([
      "noteTitle",
      "noteSummary",
      "paragraph",
    ]);
    expect(nb.dirtyNotes.has("a")).toBe(true);

    const manifest = readManifest(nb.serialize());
    expect(manifest.notes).toEqual([
      expect.objectContaining({ id: "a", schema: UM_SCHEMA_TITLE }),
    ]);
  });

  it("openable title page gets a normalized header; plain pages stay content-only", () => {
    const nb = UmNotepad.empty();
    nb.addNote(undefined, "Cover");
    const first = nb.notes()[0];
    expect(first.schema).toBe(UM_SCHEMA_TITLE);
    const doc = nb.noteContent(first.id);
    expect(doc?.content?.map((n) => n.type)).toEqual([
      "noteTitle",
      "noteSummary",
      "paragraph",
    ]);

    nb.addNote(first.id);
    const second = nb.notes()[1];
    expect(second.schema).toBe(UM_SCHEMA_PLAIN);
    const doc2 = nb.noteContent(second.id);
    expect(doc2?.content?.map((n) => n.type)).toEqual(["paragraph"]);
  });

  it("preserves uninterpretable pages verbatim through a round trip", () => {
    const nb = UmNotepad.empty();
    const first = nb.addNote(undefined, "Cover");
    nb.setNoteContent(first.id, titleDoc("Cover"));
    const second = nb.addNote(first.id);
    nb.setNoteContent(second.id, paragraphDoc("hello"));

    // Simulate a page from a future editor: unknown family, newer version.
    const descriptor = nb.note(second.id)!;
    descriptor.schema = "mindmap";
    descriptor.schemaVersion = 7;
    descriptor.title = "Future page";

    expect(nb.noteSchemaState(second.id).kind).toBe("unsupported");
    expect(nb.isNoteOpenable(second.id)).toBe(false);

    // The rewrite keeps the descriptor untouched and the document on disk.
    const manifest = readManifest(nb.serialize());
    expect(manifest.notes).toEqual([
      expect.objectContaining({ id: first.id, schema: UM_SCHEMA_TITLE }),
      expect.objectContaining({
        id: second.id,
        schema: "mindmap",
        schemaVersion: 7,
        title: "Future page",
      }),
    ]);
  });

  it("derives plain titles from the first line and mirrors title-page headers", () => {
    expect(noteDisplayTitle(paragraphDoc("From text"), "plain")).toBe("From text");
    expect(noteDisplayTitle(headingDoc("From heading"), "plain")).toBe(
      "From heading",
    );
    expect(noteDisplayTitle(paragraphDoc(), "plain")).toBe("");
    expect(noteDisplayTitle(titleDoc("Cover title"), "title")).toBe(
      "Cover title",
    );
    expect(noteDisplayTitle(titleDoc(), "title")).toBe("");
  });

  it("duplicate carries the schema and the (copy) suffix in the first line", () => {
    const nb = UmNotepad.empty();
    const cover = nb.addNote(undefined, "Cover");
    nb.setNoteContent(cover.id, titleDoc("Cover"));
    const page = nb.addNote(cover.id);
    nb.setNoteContent(page.id, paragraphDoc("Original line"));

    const copy = nb.duplicateNote(page.id);
    expect(copy?.schema).toBe(UM_SCHEMA_PLAIN);
    expect(copy?.title).toBe("Original line (copy)");
    const copyDoc = nb.noteContent(copy!.id)!;
    expect(copyDoc.content?.[0]).toEqual({
      type: "paragraph",
      content: [{ type: "text", text: "Original line (copy)" }],
    });
  });
});

describe("inferSchemaFields", () => {
  it("maps order 0 to title and everything else to plain, at the current version", () => {
    expect(inferSchemaFields(0)).toEqual({
      schema: "title",
      schemaVersion: UM_SCHEMA_VERSION,
    });
    expect(inferSchemaFields(5)).toEqual({
      schema: "plain",
      schemaVersion: UM_SCHEMA_VERSION,
    });
  });
});
