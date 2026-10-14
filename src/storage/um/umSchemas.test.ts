import { describe, expect, it } from "vitest";
import { unzipSync, zipSync } from "fflate";
import type { JSONContent } from "../../texto/core/@types";
import { UmNotepad, noteDisplayTitle } from "./umNotepad";
import {
  DESCRIPTION_PROPERTY_NAME,
  createNoteProperty,
  inferSchemaFields,
  interpretSchema,
  migrateNoteDoc,
  runMigrationChain,
} from "./umSchemas";
import {
  UM_SCHEMA_PLAIN,
  UM_SCHEMA_TITLE,
  UM_SCHEMA_VERSION_PLAIN,
  UM_SCHEMA_VERSION_TITLE,
} from "./umTypes";

/** A v2 title page (the last shape before properties): title + summary. */
function titleDoc(title = "", summary = ""): JSONContent {
  return {
    type: "noteDoc",
    content: [
      {
        type: "noteTitle",
        content: title ? [{ type: "text", text: title }] : [],
      },
      {
        type: "noteSummary",
        content: summary ? [{ type: "text", text: summary }] : [],
      },
      { type: "paragraph" },
    ],
  };
}

/** A v3 title page: title, properties, content blocks. */
function titleDocV3(
  title = "",
  properties: JSONContent[] = [],
): JSONContent {
  return {
    type: "noteDoc",
    content: [
      {
        type: "noteTitle",
        content: title ? [{ type: "text", text: title }] : [],
      },
      ...properties,
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
      version: UM_SCHEMA_VERSION_TITLE,
    });
    expect(interpretSchema({ order: 3 })).toEqual({
      kind: "openable",
      family: UM_SCHEMA_PLAIN,
      version: UM_SCHEMA_VERSION_PLAIN,
    });
  });

  it("treats a newer version of a known family as unsupported", () => {
    expect(
      interpretSchema({ order: 0, schema: "title", schemaVersion: 99 }),
    ).toEqual({
      kind: "unsupported",
      family: "title",
      version: 99,
    });
  });

  it("treats an unknown family exactly like a newer version", () => {
    expect(
      interpretSchema({ order: 1, schema: "mindmap", schemaVersion: 1 }),
    ).toEqual({
      kind: "unsupported",
      family: "mindmap",
      version: 1,
    });
    expect(
      interpretSchema({ order: 1, schema: "mindmap", schemaVersion: 42 }),
    ).toEqual({
      kind: "unsupported",
      family: "mindmap",
      version: 42,
    });
  });

  it("opens known families at the version they carry", () => {
    expect(
      interpretSchema({ order: 0, schema: "title", schemaVersion: 1 }),
    ).toEqual({
      kind: "openable",
      family: "title",
      version: 1,
    });
    expect(
      interpretSchema({ order: 0, schema: "title", schemaVersion: 3 }),
    ).toEqual({
      kind: "openable",
      family: "title",
      version: 3,
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

  it("title v2 → v3 turns the summary line into the description property", () => {
    const doc = titleDoc("Cover", "A short summary");
    const result = migrateNoteDoc("title", 2, doc);
    expect(result.ok).toBe(true);
    expect(result.toVersion).toBe(UM_SCHEMA_VERSION_TITLE);

    const content = result.doc.content ?? [];
    expect(content.map((n) => n.type)).toEqual([
      "noteTitle",
      "noteProperty",
      "paragraph",
    ]);
    // The summary text moved verbatim into the property's value.
    expect(content[1]).toEqual({
      type: "noteProperty",
      attrs: { type: "text" },
      content: [
        {
          type: "notePropertyName",
          content: [{ type: "text", text: DESCRIPTION_PROPERTY_NAME }],
        },
        {
          type: "notePropertyValue",
          content: [{ type: "text", text: "A short summary" }],
        },
      ],
    });
    // Everything else stays untouched.
    expect(content[0]).toEqual(doc.content?.[0]);
    expect(content[2]).toEqual(doc.content?.[2]);
  });

  it("title v2 → v3 passes a summary-less document through unchanged", () => {
    const doc = {
      type: "noteDoc",
      content: [
        { type: "noteTitle", content: [{ type: "text", text: "Cover" }] },
        { type: "paragraph" },
      ],
    };
    expect(migrateNoteDoc("title", 2, doc)).toEqual({
      ok: true,
      doc,
      toVersion: UM_SCHEMA_VERSION_TITLE,
    });
  });

  it("migrates v1 title docs through the whole chain to v3", () => {
    const doc = titleDoc("Cover", "Summary text");
    const result = migrateNoteDoc("title", 1, doc);
    expect(result.ok).toBe(true);
    expect(result.toVersion).toBe(UM_SCHEMA_VERSION_TITLE);
    expect(result.doc.content?.map((n) => n.type)).toEqual([
      "noteTitle",
      "noteProperty",
      "paragraph",
    ]);

    // The plain family has no breaking change after v2: identity step only.
    const plain = paragraphDoc("hello");
    expect(migrateNoteDoc("plain", 1, plain)).toEqual({
      ok: true,
      doc: plain,
      toVersion: UM_SCHEMA_VERSION_PLAIN,
    });

    // current version: nothing to migrate, fromVersion >= current is
    // rejected as a misuse.
    expect(migrateNoteDoc("title", UM_SCHEMA_VERSION_TITLE, doc)).toEqual({
      ok: false,
      doc,
      toVersion: UM_SCHEMA_VERSION_TITLE,
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

  function readNote(bytes: Uint8Array, path: string): JSONContent {
    return JSON.parse(DEC.decode(unzipSync(bytes)[path]));
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
        "notes/a.json": titleDocV3("Cover"),
        "notes/b.json": paragraphDoc("hello"),
      },
    );

    const nb = UmNotepad.fromBytes(bytes);
    expect(nb.note("a")?.schema).toBe(UM_SCHEMA_TITLE);
    expect(nb.note("a")?.schemaVersion).toBe(UM_SCHEMA_VERSION_TITLE);
    expect(nb.note("b")?.schema).toBe(UM_SCHEMA_PLAIN);
    expect(nb.note("b")?.schemaVersion).toBe(UM_SCHEMA_VERSION_PLAIN);
    // Title mirrors adopted per family (header node vs first line).
    expect(nb.note("a")?.title).toBe("Cover");
    expect(nb.note("b")?.title).toBe("hello");

    const manifest = readManifest(nb.serialize());
    expect(manifest.notes).toEqual([
      expect.objectContaining({
        id: "a",
        schema: UM_SCHEMA_TITLE,
        schemaVersion: UM_SCHEMA_VERSION_TITLE,
      }),
      expect.objectContaining({
        id: "b",
        schema: UM_SCHEMA_PLAIN,
        schemaVersion: UM_SCHEMA_VERSION_PLAIN,
      }),
    ]);
  });

  it("migrates an explicit v2 title page to v3 on read and persists it", () => {
    const bytes = zipContainer(
      {
        format: "um",
        version: 1,
        type: "notepad",
        notes: [
          {
            id: "a",
            path: "notes/a.json",
            order: 0,
            schema: UM_SCHEMA_TITLE,
            schemaVersion: 2,
          },
        ],
      },
      { "notes/a.json": titleDoc("Cover", "Legacy summary") },
    );

    const nb = UmNotepad.fromBytes(bytes);
    expect(nb.isNoteOpenable("a")).toBe(true);
    expect(nb.note("a")?.schemaVersion).toBe(UM_SCHEMA_VERSION_TITLE);
    expect(nb.dirtyNotes.has("a")).toBe(true);

    const doc = nb.noteContent("a");
    expect(doc?.content?.map((n) => n.type)).toEqual([
      "noteTitle",
      "noteProperty",
      "paragraph",
    ]);

    const saved = readNote(nb.serialize(), "notes/a.json");
    expect(saved.content?.[1]).toEqual(
      createNoteProperty(DESCRIPTION_PROPERTY_NAME, [
        [{ type: "text", text: "Legacy summary" }],
      ]),
    );
    expect(
      readManifest(nb.serialize()).notes,
    ).toEqual([
      expect.objectContaining({
        id: "a",
        schemaVersion: UM_SCHEMA_VERSION_TITLE,
      }),
    ]);
  });

  it("normalizes a legacy (fields-absent) title page: summary becomes the description property", () => {
    const bytes = zipContainer(
      {
        format: "um",
        version: 1,
        type: "notepad",
        notes: [{ id: "a", path: "notes/a.json", order: 0, title: "Old" }],
      },
      { "notes/a.json": titleDoc("Old", "Old summary") },
    );

    const nb = UmNotepad.fromBytes(bytes);
    expect(nb.isNoteOpenable("a")).toBe(true);
    // Stamped straight to the current version; the shape repair happens in
    // the title normalization (no explicit migration ran).
    expect(nb.note("a")?.schemaVersion).toBe(UM_SCHEMA_VERSION_TITLE);
    expect(nb.noteContent("a")?.content?.map((n) => n.type)).toEqual([
      "noteTitle",
      "noteProperty",
      "paragraph",
    ]);
    expect(nb.dirtyNotes.has("a")).toBe(true);
  });

  it("leaves a legacy title page that is already v3-shaped untouched", () => {
    const bytes = zipContainer(
      {
        format: "um",
        version: 1,
        type: "notepad",
        notes: [{ id: "a", path: "notes/a.json", order: 0, title: "Old" }],
      },
      {
        // Pre-summary era shape, valid v3: title + content block.
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
      "paragraph",
    ]);
    expect(nb.dirtyNotes.has("a")).toBe(false);
  });

  it("never lowers a title page's schema version across save/reload cycles (8.6.2)", () => {
    const bytes = zipContainer(
      {
        format: "um",
        version: 1,
        type: "notepad",
        notes: [
          {
            id: "a",
            path: "notes/a.json",
            order: 0,
            schema: UM_SCHEMA_TITLE,
            schemaVersion: 2,
          },
        ],
      },
      { "notes/a.json": titleDoc("Cover", "Summary") },
    );

    // First open: migrates to 3 and persists.
    const first = UmNotepad.fromBytes(bytes);
    const savedBytes = first.serialize();
    const saved = UmNotepad.fromBytes(savedBytes);
    expect(saved.note("a")?.schemaVersion).toBe(UM_SCHEMA_VERSION_TITLE);

    // Second open from the migrated bytes: stays 3, nothing pending.
    const resaved = UmNotepad.fromBytes(saved.serialize());
    expect(resaved.note("a")?.schemaVersion).toBe(UM_SCHEMA_VERSION_TITLE);
    expect(resaved.dirtyNotes.has("a")).toBe(false);
  });

  it("repairs a .um page cell ending on an image on read (persists on save)", () => {
    // Externally produced page: a plain page whose first cell ends on an
    // image — no caret place below it. The read-time repair must fix it
    // before the page reaches the editor (PR #3 review, P1).
    const cellImageDoc: JSONContent = {
      type: "noteDoc",
      content: [
        {
          type: "table",
          content: [
            {
              type: "tableRow",
              content: [
                {
                  type: "tableCell",
                  content: [
                    {
                      type: "image",
                      attrs: {
                        key: "k1",
                        data: { id: "asset-1", size: "9", filename: "p.png" },
                      },
                    },
                  ],
                },
                { type: "tableCell", content: [{ type: "paragraph" }] },
              ],
            },
          ],
        },
      ],
    };
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
      { "notes/a.json": titleDocV3("Cover"), "notes/b.json": cellImageDoc },
    );

    const nb = UmNotepad.fromBytes(bytes);
    const doc = nb.noteContent("b");
    const cell = doc?.content?.[0]?.content?.[0]?.content?.[0];
    expect(cell?.content?.map((n) => n.type)).toEqual(["image", "paragraph"]);

    // The repair marks the page dirty: the next save persists it.
    const saved = readNote(nb.serialize(), "notes/b.json");
    const savedCell = saved.content?.[0]?.content?.[0]?.content?.[0];
    expect(savedCell?.content?.map((n) => n.type)).toEqual([
      "image",
      "paragraph",
    ]);
  });

  it("openable title page starts title-first without a pre-created property; plain pages stay content-only", () => {
    const nb = UmNotepad.empty();
    nb.addNote(undefined, "Cover");
    const first = nb.notes()[0];
    expect(first.schema).toBe(UM_SCHEMA_TITLE);
    expect(first.schemaVersion).toBe(UM_SCHEMA_VERSION_TITLE);
    const doc = nb.noteContent(first.id);
    expect(doc?.content?.map((n) => n.type)).toEqual([
      "noteTitle",
      "paragraph",
    ]);

    nb.addNote(first.id);
    const second = nb.notes()[1];
    expect(second.schema).toBe(UM_SCHEMA_PLAIN);
    const doc2 = nb.noteContent(second.id);
    expect(doc2?.content?.map((n) => n.type)).toEqual(["paragraph"]);
  });

  it("a title page whose content was replaced by properties still keeps a content block", () => {
    const nb = UmNotepad.empty();
    const cover = nb.addNote(undefined, "Cover");
    nb.setNoteContent(cover.id, {
      type: "noteDoc",
      content: [
        { type: "noteTitle", content: [{ type: "text", text: "Cover" }] },
        createNoteProperty("tags", [[{ type: "text", text: "one" }]], "list"),
      ],
    });
    // setNoteContent stores as-is; the read path (next load) repairs.
    const reopened = new UmNotepad(nb.data);
    expect(reopened.noteContent(cover.id)?.content?.map((n) => n.type)).toEqual(
      ["noteTitle", "noteProperty", "paragraph"],
    );
  });

  it("preserves uninterpretable pages verbatim through a round trip", () => {
    const nb = UmNotepad.empty();
    const first = nb.addNote(undefined, "Cover");
    nb.setNoteContent(first.id, titleDocV3("Cover"));
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
    expect(noteDisplayTitle(paragraphDoc("From text"), "plain")).toBe(
      "From text",
    );
    expect(noteDisplayTitle(headingDoc("From heading"), "plain")).toBe(
      "From heading",
    );
    expect(noteDisplayTitle(paragraphDoc(), "plain")).toBe("");
    expect(noteDisplayTitle(titleDocV3("Cover title"), "title")).toBe(
      "Cover title",
    );
    expect(noteDisplayTitle(titleDocV3(), "title")).toBe("");
  });

  it("duplicate carries the schema and the (copy) suffix in the first line", () => {
    const nb = UmNotepad.empty();
    const cover = nb.addNote(undefined, "Cover");
    nb.setNoteContent(cover.id, titleDocV3("Cover"));
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
  it("maps order 0 to title and everything else to plain, each at its family's current version", () => {
    expect(inferSchemaFields(0)).toEqual({
      schema: "title",
      schemaVersion: UM_SCHEMA_VERSION_TITLE,
    });
    expect(inferSchemaFields(5)).toEqual({
      schema: "plain",
      schemaVersion: UM_SCHEMA_VERSION_PLAIN,
    });
  });
});
