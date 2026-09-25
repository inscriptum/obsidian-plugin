import { describe, expect, it } from "vitest";
import { unzipSync, zipSync } from "fflate";
import type { JSONContent } from "../../texto/core/@types";
import { createEmptyNote } from "../noteStorage";
import {
  assetExtension,
  assetPathForId,
  collectReferencedAssetIds,
  notePathForId,
  parseUmContainer,
  serializeUmContainer,
  sortNoteDescriptors,
} from "./umContainer";
import { generateUmId, isUmId } from "./umIds";
import { noteDocTitle, createTitleNoteDoc, UmNotepad } from "./umNotepad";
import { FROZEN_MTIME, UmError } from "./umTypes";

const ENC = new TextEncoder();
const DEC = new TextDecoder();

function helloDoc(text: string): JSONContent {
  return {
    type: "noteDoc",
    content: [
      { type: "noteTitle", content: [{ type: "text", text }] },
      { type: "paragraph" },
    ],
  };
}

function notepadWithTwoNotes(): UmNotepad {
  const nb = UmNotepad.empty();
  const a = nb.addNote(undefined, "First");
  nb.setNoteContent(a.id, helloDoc("First"));
  const b = nb.addNote(a.id, "Second");
  nb.setNoteContent(b.id, helloDoc("Second"));
  nb.dirtyNotes.clear();
  nb.structureChanged = false;
  return nb;
}

describe("umIds", () => {
  it("generates unique 26-char base32 ids", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const id = generateUmId();
      expect(id).toHaveLength(26);
      expect(isUmId(id)).toBe(true);
      seen.add(id);
    }
    expect(seen.size).toBe(1000);
  });

  it("is monotonic within the same millisecond", () => {
    const now = 1700000000000;
    const a = generateUmId(now);
    const b = generateUmId(now);
    expect(a).not.toBe(b);
    expect(a < b).toBe(true);
  });

  it("rejects non-ULID shapes", () => {
    expect(isUmId("notes/photo.png")).toBe(false);
    expect(isUmId("short")).toBe(false);
    expect(isUmId(null)).toBe(false);
  });
});

describe("parseUmContainer / serializeUmContainer", () => {
  it("round-trips notes, titles and order", () => {
    const nb = notepadWithTwoNotes();
    const parsed = parseUmContainer(nb.serialize());

    expect(parsed.manifest.format).toBe("um");
    expect(parsed.manifest.version).toBe(1);
    expect(parsed.manifest.type).toBe("notepad");
    const notes = sortNoteDescriptors(parsed.manifest.notes);
    expect(notes.map((n) => n.title)).toEqual(["First", "Second"]);
    expect(notes.map((n) => n.order)).toEqual([0, 1]);
    const firstDoc = parsed.notes.get(notes[0].id);
    expect(DEC.decode(ENC.encode("")).length).toBe(0);
    expect(firstDoc?.type).toBe("noteDoc");
    expect(JSON.stringify(firstDoc)).toContain("First");
  });

  it("round-trips assets byte-for-byte", () => {
    const nb = notepadWithTwoNotes();
    const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
    const asset = nb.addAsset(png, "shot.png", "image/png");
    const doc = helloDoc("with image");
    doc.content?.push({
      type: "image",
      attrs: { data: { id: asset.id, size: "7", filename: "shot.png" } },
    });
    const note = nb.notes()[0];
    nb.setNoteContent(note.id, doc);

    const parsed = parseUmContainer(nb.serialize());
    expect(parsed.assets.get(asset.id)).toEqual(png);
    expect(parsed.manifest.assets?.[0].path).toBe(
      assetPathForId(asset.id, "png"),
    );
    expect(parsed.manifest.assets?.[0].type).toBe("image/png");
    expect(parsed.manifest.assets?.[0].size).toBe(7);
  });

  it("preserves unknown manifest fields (spec 12.1)", () => {
    const nb = notepadWithTwoNotes();
    const parsedOnce = parseUmContainer(nb.serialize());
    (parsedOnce.manifest as Record<string, unknown>)["customFeature"] = {
      whatever: [1, 2, 3],
    };
    (parsedOnce.manifest as Record<string, unknown>)["metadata"] = { a: "b" };

    const reparsed = parseUmContainer(serializeUmContainer(parsedOnce));
    expect(reparsed.manifest["customFeature"]).toEqual({ whatever: [1, 2, 3] });
    expect(reparsed.manifest["metadata"]).toEqual({ a: "b" });
  });

  it("preserves unknown archive entries (spec 3, 12)", () => {
    const nb = notepadWithTwoNotes();
    const bytes = nb.serialize();
    // Hand-craft a container with a foreign directory by rebuilding the zip
    // via the parsed data: inject into unknownEntries.
    const parsed = parseUmContainer(bytes);
    parsed.unknownEntries.set("history/01JABC/steps.json", ENC.encode("[]"));
    parsed.unknownEntries.set("editors/review", ENC.encode("{}"));

    const reparsed = parseUmContainer(serializeUmContainer(parsed));
    expect(reparsed.unknownEntries.has("history/01JABC/steps.json")).toBe(true);
    expect(DEC.decode(reparsed.unknownEntries.get("editors/review"))).toBe(
      "{}",
    );
  });

  it("treats unlisted files under notes/ and assets/ as unknown, not fatal", () => {
    const nb = notepadWithTwoNotes();
    const parsed = parseUmContainer(nb.serialize());
    parsed.unknownEntries.set("notes/orphan.json", ENC.encode("{}"));
    parsed.unknownEntries.set("assets/orphan.png", new Uint8Array([1]));

    expect(() => parseUmContainer(serializeUmContainer(parsed))).not.toThrow();
  });

  it("serializes deterministically", () => {
    const nb = notepadWithTwoNotes();
    const png = new Uint8Array([9, 8, 7, 6]);
    const asset = nb.addAsset(png, "a.jpg", "image/jpeg");
    const doc = helloDoc("x");
    doc.content?.push({ type: "image", attrs: { data: { id: asset.id } } });
    nb.setNoteContent(nb.notes()[0].id, doc);
    nb.dirtyNotes.clear();

    const a = nb.serialize();
    const b = nb.serialize();
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    // A parse→serialize round trip is stable too.
    const c = serializeUmContainer(parseUmContainer(a));
    expect(Buffer.from(c).equals(Buffer.from(a))).toBe(true);
  });

  it("reindexes non-contiguous orders while preserving relative order (spec 8.3)", () => {
    const nb = notepadWithTwoNotes();
    const parsed = parseUmContainer(nb.serialize());
    const notes = parsed.manifest.notes;
    notes[0].order = 5;
    notes[1].order = 42;

    const reserialized = parseUmContainer(serializeUmContainer(parsed));
    const sorted = sortNoteDescriptors(reserialized.manifest.notes);
    expect(sorted.map((n) => n.title)).toEqual(["First", "Second"]);
    expect(sorted.map((n) => n.order)).toEqual([0, 1]);
  });

  it("writes note documents at the recommended path", () => {
    const nb = notepadWithTwoNotes();
    const files = unzipSync(nb.serialize());
    for (const descriptor of parseUmContainer(nb.serialize()).manifest.notes) {
      expect(descriptor.path).toBe(notePathForId(descriptor.id));
      expect(files[descriptor.path]).toBeDefined();
    }
  });

  it.each([
    [
      "no-manifest",
      new Uint8Array([
        80, 75, 5, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
      ]),
    ],
  ])("rejects an archive without a manifest (%s)", (code, bytes) => {
    try {
      parseUmContainer(bytes);
      throw new Error("expected UmError");
    } catch (err) {
      expect(err).toBeInstanceOf(UmError);
      expect((err as UmError).code).toBe(code);
    }
  });

  it("reports precise error codes for broken manifests", () => {
    // Zip a broken manifest directly: serializeUmContainer must stay a
    // total function over parsed data, validation lives in parse.
    const makeBytes = (override: Record<string, unknown>): Uint8Array => {
      const base = UmNotepad.empty();
      const manifest = {
        ...parseUmContainer(base.serialize()).manifest,
        ...override,
      };
      return zipSync(
        { "manifest.json": ENC.encode(JSON.stringify(manifest)) },
        { mtime: FROZEN_MTIME },
      );
    };

    const expectCode = (bytes: Uint8Array, code: string) => {
      try {
        parseUmContainer(bytes);
        throw new Error(`expected UmError ${code}`);
      } catch (err) {
        expect(err).toBeInstanceOf(UmError);
        expect((err as UmError).code).toBe(code);
      }
    };

    expectCode(makeBytes({ format: "no" }), "bad-format");
    expectCode(makeBytes({ version: 2 }), "bad-version");
    expectCode(makeBytes({ type: "binder" }), "bad-type");
    expectCode(makeBytes({ notes: "nope" }), "bad-notes");
    expectCode(makeBytes({ notes: [{ id: "x" }] }), "bad-descriptor");
  });

  it("rejects duplicate note ids and missing note documents", () => {
    const nb = notepadWithTwoNotes();
    const data = parseUmContainer(nb.serialize());
    const [a, b] = data.manifest.notes;
    b.id = a.id;
    try {
      parseUmContainer(serializeUmContainer(data));
      throw new Error("expected UmError");
    } catch (err) {
      expect((err as UmError).code).toBe("duplicate-id");
    }

    const data2 = parseUmContainer(nb.serialize());
    const descriptor = data2.manifest.notes[1];
    data2.notes.delete(descriptor.id);
    try {
      parseUmContainer(serializeUmContainer(data2));
      throw new Error("expected UmError");
    } catch (err) {
      expect((err as UmError).code).toBe("missing-note");
    }
  });

  it("accepts an empty notepad (spec 21)", () => {
    const nb = UmNotepad.empty();
    const parsed = parseUmContainer(nb.serialize());
    expect(parsed.manifest.notes).toEqual([]);
    expect(sortNoteDescriptors(parsed.manifest.notes)).toEqual([]);
  });
});

describe("UmNotepad", () => {
  it("adds a note after a given note with contiguous orders", () => {
    const nb = notepadWithTwoNotes();
    const first = nb.notes()[0];
    const added = nb.addNote(first.id, "Inserted");
    expect(nb.notes().map((n) => n.title)).toEqual([
      "First",
      "Inserted",
      "Second",
    ]);
    expect(nb.notes().map((n) => n.order)).toEqual([0, 1, 2]);
    expect(nb.noteContent(added.id)?.type).toBe("noteDoc");
  });

  it("gc keeps referenced assets across notes and drops the rest", () => {
    const nb = notepadWithTwoNotes();
    const kept = nb.addAsset(new Uint8Array([1]), "kept.png", "image/png");
    const dropped = nb.addAsset(
      new Uint8Array([2]),
      "dropped.png",
      "image/png",
    );

    const doc = helloDoc("ref");
    doc.content?.push({ type: "image", attrs: { data: { id: kept.id } } });
    nb.setNoteContent(nb.notes()[0].id, doc);

    expect(nb.gcAssets()).toBe(1);
    expect(nb.isAssetId(kept.id)).toBe(true);
    expect(nb.isAssetId(dropped.id)).toBe(false);
    expect(nb.data.assets.has(dropped.id)).toBe(false);
  });

  it("collects only asset references, not external vault links", () => {
    const nb = notepadWithTwoNotes();
    const asset = nb.addAsset(new Uint8Array([1]), "in.png", "image/png");

    const doc = helloDoc("mixed");
    doc.content?.push({
      type: "image",
      attrs: { data: { id: asset.id } },
    });
    doc.content?.push({
      type: "image",
      attrs: { data: { id: "attachments/external.png" } },
    });
    nb.setNoteContent(nb.notes()[0].id, doc);

    const refs = nb.referencedAssetIds();
    expect(refs.has(asset.id)).toBe(true);
    expect(refs.size).toBe(1);
    expect(collectReferencedAssetIds(doc, new Set([asset.id])).size).toBe(1);
  });

  it("tracks dirty notes", () => {
    const nb = notepadWithTwoNotes();
    expect(nb.dirtyNotes.size).toBe(0);
    const id = nb.notes()[0].id;
    nb.setNoteContent(id, helloDoc("changed"));
    expect(nb.dirtyNotes.has(id)).toBe(true);
  });

  it("adopts the document's first line as the title on load (spec 8.4)", () => {
    const nb = notepadWithTwoNotes();
    const data = parseUmContainer(nb.serialize());
    const first = data.manifest.notes[0];
    first.title = "stale manifest title";
    const doc = data.notes.get(first.id);
    // Document's first line says "hhhhh" — it must win over the manifest.
    doc.content[0] = {
      type: "noteTitle",
      content: [{ type: "text", text: "hhhhh" }],
    };

    const reopened = UmNotepad.fromBytes(serializeUmContainer(data));
    expect(reopened.note(first.id)?.title).toBe("hhhhh");
  });

  it("mirrors title changes from setNoteContent", () => {
    const nb = notepadWithTwoNotes();
    const id = nb.notes()[0].id;
    nb.setNoteContent(id, helloDoc("New first line"));
    expect(nb.note(id)?.title).toBe("New first line");
  });

  it("setDisplayTitle rewrites the document's first line, not just the manifest", () => {
    const nb = notepadWithTwoNotes();
    const id = nb.notes()[0].id;
    nb.setDisplayTitle(id, "Renamed");
    expect(nb.note(id)?.title).toBe("Renamed");
    const titleNode = nb
      .noteContent(id)
      ?.content?.find((n) => n.type === "noteTitle");
    expect(titleNode?.content).toEqual([{ type: "text", text: "Renamed" }]);
    expect(nb.dirtyNotes.has(id)).toBe(true);
  });

  it("addNote with a title writes it into the document's first line", () => {
    const nb = UmNotepad.empty();
    const added = nb.addNote(undefined, "Starter");
    const titleNode = nb
      .noteContent(added.id)
      ?.content?.find((n) => n.type === "noteTitle");
    expect(titleNode?.content).toEqual([{ type: "text", text: "Starter" }]);
    expect(nb.note(added.id)?.title).toBe("Starter");
  });

  it("derives an empty title from a note without title text", () => {
    const nb = notepadWithTwoNotes();
    const id = nb.notes()[0].id;
    const doc = helloDoc("");
    doc.content = doc.content?.map((n) =>
      n.type === "noteTitle" ? { type: "noteTitle" } : n,
    );
    nb.setNoteContent(id, doc);
    expect(nb.note(id)?.title).toBe("");
    expect(noteDocTitle(doc)).toBe("");
  });

  it("removeNote drops the note and reindexes; restoreNote puts it back", () => {
    const nb = notepadWithTwoNotes();
    const second = nb.notes()[1];
    const removed = nb.removeNote(second.id);
    expect(removed).not.toBeNull();
    expect(nb.notes().map((n) => n.id)).toEqual([nb.notes()[0].id]);
    expect(nb.notes()[0].order).toBe(0);
    expect(nb.noteContent(second.id)).toBeUndefined();

    nb.restoreNote(removed);
    expect(nb.notes().map((n) => n.title)).toEqual(["First", "Second"]);
    expect(nb.noteContent(second.id)).toEqual(helloDoc("Second"));
    expect(nb.notes()[1].order).toBe(1);
  });

  it("removeNote of the first note restores at the original index", () => {
    const nb = notepadWithTwoNotes();
    const first = nb.notes()[0];
    const removed = nb.removeNote(first.id);
    nb.restoreNote(removed);
    expect(nb.notes().map((n) => n.title)).toEqual(["First", "Second"]);
  });

  it("removeNote returns null for an unknown id", () => {
    const nb = notepadWithTwoNotes();
    expect(nb.removeNote("missing")).toBeNull();
  });

  it("duplicateNote copies the document after the original with a fresh id", () => {
    const nb = notepadWithTwoNotes();
    const first = nb.notes()[0];
    const copy = nb.duplicateNote(first.id);

    expect(copy).not.toBeNull();
    expect(copy?.id).not.toBe(first.id);
    expect(copy?.title).toBe("First (copy)");
    expect(nb.notes().map((n) => n.title)).toEqual([
      "First",
      "First (copy)",
      "Second",
    ]);
    expect(nb.notes().map((n) => n.order)).toEqual([0, 1, 2]);
    // The copy's first line carries the "(copy)" title so the mirror sync
    // does not wipe the suffix on reload.
    const copyTitleNode = nb
      .noteContent(copy.id)
      ?.content?.find((n) => n.type === "noteTitle");
    expect(copyTitleNode?.content).toEqual([
      { type: "text", text: "First (copy)" },
    ]);

    const parsed = parseUmContainer(nb.serialize());
    expect(parsed.notes.get(copy.id)).toEqual(nb.noteContent(copy.id));
  });

  it("duplicateNote of an untitled note stays untitled", () => {
    const nb = notepadWithTwoNotes();
    const copy = nb.duplicateNote(nb.notes()[1].id);
    expect(copy?.title).toBe("Second (copy)");
    const empty = UmNotepad.empty();
    const added = empty.addNote();
    const copy2 = empty.duplicateNote(added.id);
    expect(copy2?.title ?? "").toBe("");
  });

  it("moveNote reorders without touching ids or content", () => {
    const nb = notepadWithTwoNotes();
    const first = nb.notes()[0];
    expect(nb.moveNote(first.id, 1)).toBe(true);
    expect(nb.notes().map((n) => n.title)).toEqual(["Second", "First"]);
    expect(nb.notes().map((n) => n.order)).toEqual([0, 1]);
    expect(nb.noteContent(first.id)).toEqual(helloDoc("First"));

    // round-trip keeps the new order
    const parsed = parseUmContainer(nb.serialize());
    expect(
      sortNoteDescriptors(parsed.manifest.notes).map((n) => n.title),
    ).toEqual(["Second", "First"]);
  });

  it("moveNote clamps out-of-range indexes", () => {
    const nb = notepadWithTwoNotes();
    const first = nb.notes()[0];
    nb.moveNote(first.id, 99);
    expect(nb.notes().map((n) => n.title)).toEqual(["Second", "First"]);
  });

  it("persists the expanded flag and defaults to collapsed", () => {
    const nb = notepadWithTwoNotes();
    expect(nb.isExpanded(nb.notes()[0].id)).toBe(false); // absent = collapsed
    nb.setExpanded(nb.notes()[0].id, true);

    const reopened = UmNotepad.fromBytes(nb.serialize());
    expect(reopened.isExpanded(nb.notes()[0].id)).toBe(true);
    expect(reopened.isExpanded(nb.notes()[1].id)).toBe(false);

    // Collapsing removes the flag from the manifest.
    reopened.setExpanded(reopened.notes()[0].id, false);
    const final = UmNotepad.fromBytes(reopened.serialize());
    expect(final.notes()[0].expanded).toBeUndefined();
    expect(final.notes()[0].expanded === undefined).toBe(true);
  });

  it("restores the expanded flag together with a removed note", () => {
    const nb = notepadWithTwoNotes();
    const first = nb.notes()[0];
    nb.setExpanded(first.id, true);
    const removed = nb.removeNote(first.id);
    expect(nb.isExpanded(first.id)).toBe(false);
    nb.restoreNote(removed);
    expect(nb.isExpanded(first.id)).toBe(true);
  });
});

describe("path helpers", () => {
  it("derives asset extensions from filename or mime", () => {
    expect(assetExtension("photo.PNG")).toBe("png");
    expect(assetExtension("noext", "image/webp")).toBe("webp");
    expect(assetExtension("noext", "image/svg+xml")).toBe("svg");
    expect(assetExtension("noext")).toBe("bin");
    expect(assetPathForId("01JABC", "png")).toBe("assets/01JABC.png");
  });
});

describe("createEmptyNote compatibility", () => {
  it("a plain .note document is a valid note payload (spec 9)", () => {
    const nb = UmNotepad.empty();
    // A page added into an empty notepad becomes the title page (order 0):
    // its starter document carries the title/summary header (spec 9.1).
    const added = nb.addNote();
    expect(nb.noteContent(added.id)).toEqual(createTitleNoteDoc());
    const parsed = parseUmContainer(nb.serialize());
    expect(parsed.notes.get(added.id)).toEqual(createTitleNoteDoc());

    // The plain .note starter (noteTitle + paragraph) stays a valid payload
    // for any page: setNoteContent accepts it, the plain profile parses it.
    nb.setNoteContent(added.id, createEmptyNote());
    expect(nb.noteContent(added.id)).toEqual(createEmptyNote());
  });
});
