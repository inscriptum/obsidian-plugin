import { describe, expect, it } from "vitest";
import { parseUmContainer, serializeUmContainer } from "./umContainer";
import {
  UM_COMMENTS_ENTRY,
  parseThreads,
  serializeThreads,
} from "./umComments";
import { UmNotepad } from "./umNotepad";
import type { CommentThread } from "../../texto/extensions/comment/model";
import type { UmManifest } from "./umTypes";

const thread = (id: string, noteId = "note1"): CommentThread => ({
  id,
  noteId,
  resolved: false,
  comments: [
    { id: `${id}-c1`, author: "You", content: "first", createdAt: 1000 },
    { id: `${id}-c2`, author: "You", content: "second", createdAt: 2000 },
  ],
});

describe("threads JSONL codec", () => {
  it("round-trips threads through JSONL", () => {
    const bytes = serializeThreads([thread("T1"), thread("T2", "note2")]);
    const parsed = parseThreads(bytes);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual(thread("T1"));
    expect(parsed[1].noteId).toBe("note2");
  });

  it("one thread per line (spec: jsonl entry)", () => {
    const text = new TextDecoder().decode(serializeThreads([thread("T1")]));
    const lines = text.trim().split("\n");
    expect(lines).toHaveLength(1);
    const line = JSON.parse(lines[0]) as { id?: string };
    expect(line.id).toBe("T1");
  });

  it("tolerates junk: broken lines and bad shapes are skipped", () => {
    const text = [
      "{not json",
      JSON.stringify({ id: "x" }), // missing fields
      JSON.stringify(thread("T1")),
      "", // empty line
      JSON.stringify(thread("T1")), // duplicate id keeps the first
    ].join("\n");
    const parsed = parseThreads(new TextEncoder().encode(text));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe("T1");
    expect(parsed[0].comments).toHaveLength(2);
  });

  it("an empty store parses as no threads", () => {
    expect(parseThreads(serializeThreads([]))).toEqual([]);
    expect(parseThreads(new TextEncoder().encode(""))).toEqual([]);
  });
});

const containerWith = (entries: Record<string, Uint8Array>): Uint8Array => {
  const manifest: UmManifest = {
    format: "um",
    version: 1,
    type: "notepad",
    notes: [
      {
        id: "note1",
        path: "notes/note1.json",
        order: 0,
        title: "Page",
        schema: "plain",
        schemaVersion: 3,
      },
    ],
  };
  const data = {
    manifest,
    notes: new Map([
      ["note1", { type: "noteDoc", content: [{ type: "paragraph" }] }],
    ]),
    assets: new Map(),
    unknownEntries: new Map(Object.entries(entries)),
  };
  return serializeUmContainer(data);
};

describe("UmNotepad thread store", () => {
  it("reads and writes threads across a container round trip", () => {
    const bytes = containerWith({
      [UM_COMMENTS_ENTRY]: serializeThreads([thread("T1")]),
    });
    const notepad = UmNotepad.fromBytes(bytes);
    expect(notepad.readThreads().map((t) => t.id)).toEqual(["T1"]);

    notepad.writeThreads([thread("T1"), thread("T2", "note1")]);
    expect(notepad.structureChanged).toBe(true);

    const round = UmNotepad.fromBytes(notepad.serialize());
    expect(round.readThreads().map((t) => t.id)).toEqual(["T1", "T2"]);
    expect(round.readThreads()[1].comments[1].content).toBe("second");
  });

  it("a container without the entry reads as no threads", () => {
    const notepad = UmNotepad.fromBytes(containerWith({}));
    expect(notepad.readThreads()).toEqual([]);
    // Writing nothing does not dirty the container.
    notepad.writeThreads([]);
    expect(notepad.structureChanged).toBe(false);
  });

  it("writing no threads removes the entry from the archive", () => {
    const bytes = containerWith({
      [UM_COMMENTS_ENTRY]: serializeThreads([thread("T1")]),
    });
    const notepad = UmNotepad.fromBytes(bytes);
    notepad.writeThreads([]);
    expect(notepad.structureChanged).toBe(true);
    const data = parseUmContainer(notepad.serialize());
    expect(data.unknownEntries.has(UM_COMMENTS_ENTRY)).toBe(false);
  });

  it("old-version compatibility: the entry rides the container verbatim", () => {
    // A foreign entry (unknown to this build) and the comments entry both
    // survive load → save untouched when never touched by the store API.
    const foreign = new TextEncoder().encode("whatever");
    const bytes = containerWith({
      "unknown-blob.bin": foreign,
      [UM_COMMENTS_ENTRY]: serializeThreads([thread("T1")]),
    });
    const round = parseUmContainer(
      UmNotepad.fromBytes(bytes).serialize(),
    );
    expect(round.unknownEntries.get("unknown-blob.bin")).toEqual(foreign);
    expect(parseThreads(round.unknownEntries.get(UM_COMMENTS_ENTRY)!)).toEqual([
      thread("T1"),
    ]);
  });
});
