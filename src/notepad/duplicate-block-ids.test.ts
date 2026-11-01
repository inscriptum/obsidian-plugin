import { describe, expect, it } from "vitest";
// Direct mock import: the runtime mock's TFile takes a path (the real
// obsidian.d.ts declares a 0-arg constructor).
import { TFile, WorkspaceLeaf } from "../__mocks__/obsidian";

import { NotepadView } from "../NotepadView";
import { UmNotepad } from "../storage/um/umNotepad";
import { assignBlockIds, isBlockId } from "../texto/extensions/block-ids";
import type { JSONContent } from "../texto/core/@types";
import { Editor } from "../texto/core/Editor";
import { getExtensions } from "../texto/getExtensions";

interface WithId {
  id?: string | null;
}

function walkIds(node: JSONContent, out: string[]): void {
  const id = (node.attrs as WithId | undefined)?.id;
  if (typeof id === "string") out.push(id);
  node.content?.forEach((child) => walkIds(child, out));
}

/**
 * The Duplicate-page command is the ONLY guard against cross-page
 * id duplicates: duplicateNote deep-copies the page JSON verbatim (ids
 * included) and every per-page net sees a self-consistent document, so the
 * reassign in the view layer is the single line standing between a page
 * copy and ambiguous cross-page addressing (review CR-04).
 */
describe("NotepadView duplicateNote — block ids wiring", () => {
  it("gives the page copy a disjoint, grammar-valid id set", () => {
    const notepad = UmNotepad.empty();
    const title = notepad.addNote(undefined, "Title");
    const page = notepad.addNote(title.id, "Page");
    notepad.setNoteContent(page.id, assignBlockIds({
      type: "noteDoc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "one" }] },
        { type: "paragraph", content: [{ type: "text", text: "two" }] },
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [{ type: "paragraph", content: [{ type: "text", text: "item" }] }],
            },
          ],
        },
      ],
    }));
    const sourceIds: string[] = [];
    walkIds(notepad.noteContent(page.id)!, sourceIds);
    expect(sourceIds.length).toBeGreaterThanOrEqual(4);

    // Field injection, mirroring the e2e harness mount: onOpen's vault
    // wiring is not exercised, and render/flushSave are separate concerns.
    const view = new NotepadView(new WorkspaceLeaf() as never);
    const v = view as unknown as Record<string, unknown>;
    v.app = { vault: {}, workspace: { on: () => () => {} } };
    v.file = new TFile("test.um");
    v.notepad = notepad;
    (view as unknown as { render(): void }).render = () => {};
    (view as unknown as { flushSave(): Promise<void> }).flushSave = () =>
      Promise.resolve();

    (view as unknown as { duplicateNote(id: string): void }).duplicateNote(
      page.id,
    );

    // The copy landed next to the source (plain pages take their title
    // from the first line, so the copy is located by id, not by title).
    const copy = notepad
      .notes()
      .find((n) => n.id !== title.id && n.id !== page.id);
    expect(copy).toBeDefined();
    expect(copy!.order).toBe(page.order + 1);
    const copyIds: string[] = [];
    walkIds(notepad.noteContent(copy!.id)!, copyIds);

    expect(copyIds).toHaveLength(sourceIds.length);
    for (const id of copyIds) expect(isBlockId(id)).toBe(true);
    for (const id of copyIds) expect(sourceIds).not.toContain(id);
    // The source keeps its ids verbatim.
    walkIds(notepad.noteContent(page.id)!, sourceIds);
    for (const id of copyIds) expect(sourceIds).not.toContain(id);
  });
});

/**
 * The write/export path net (review CR-23 — same wiring class as CR-04):
 * fixBlockIdConflicts must run BEFORE the page editors are flushed, or a
 * defective live document reaches the notepad model and the disk un-fixed.
 * getNotepadForExport is the cheapest real entry point to the wiring.
 */
describe("NotepadView getNotepadForExport — block id net wiring", () => {
  it("repairs duplicate ids in the live editor before flushing the model", () => {
    const notepad = UmNotepad.empty();
    const title = notepad.addNote(undefined, "Title");
    const page = notepad.addNote(title.id, "Page");
    // The model carries a self-consistent page; the LIVE editor holds a
    // transient duplicate (e.g. from a mid-flight batch).
    notepad.setNoteContent(page.id, {
      type: "noteDoc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "one" }] },
        { type: "paragraph", content: [{ type: "text", text: "two" }] },
      ],
    });

    const element = createDiv();
    document.body.appendChild(element);
    const editor = new Editor({
      element,
      content: {
        type: "noteDoc",
        content: [
          { type: "noteTitle", content: [{ type: "text", text: "T" }] },
          { type: "paragraph", attrs: { id: "deadbeef01" }, content: [{ type: "text", text: "one" }] },
          { type: "paragraph", attrs: { id: "deadbeef01" }, content: [{ type: "text", text: "two" }] },
        ],
      },
      extensions: getExtensions(),
      editable: true,
    });

    const view = new NotepadView(new WorkspaceLeaf() as never);
    const v = view as unknown as Record<string, unknown>;
    v.app = { vault: {}, workspace: { on: () => () => {} } };
    v.file = new TFile("test.um");
    v.notepad = notepad;
    v.sections = new Map([["page-under-test", { id: page.id, editor }]]);

    const returned = (
      view as unknown as { getNotepadForExport(): UmNotepad | null }
    ).getNotepadForExport();
    expect(returned).not.toBeNull();

    const modelIds: string[] = [];
    walkIds(notepad.noteContent(page.id)!, modelIds);
    expect(modelIds).toHaveLength(3);
    expect(new Set(modelIds).size).toBe(3);
    for (const id of modelIds) expect(isBlockId(id)).toBe(true);
    // The live editor was repaired in place (the flush wrote its doc).
    const liveIds: string[] = [];
    editor.state.doc.descendants((n) => {
      const id = (n.attrs as WithId).id;
      if (typeof id === "string") liveIds.push(id);
      return true;
    });
    expect(new Set(liveIds).size).toBe(3);
    editor.destroy();
    element.remove();
  });
});

/**
 * The DISK-path pin (review CR-29): the export wiring above is covered,
 * but writePendingChanges — the path that actually serializes the
 * container — had no pin, so deleting the net call there left every test
 * green. This test fails if fixBlockIdConflicts is dropped from the write
 * path: the defective live editor would reach the model and the
 * serialized bytes with its duplicates intact.
 */
describe("NotepadView writePendingChanges — block id net wiring (disk)", () => {
  it("repairs defective editors before the container is serialized", async () => {
    const notepad = UmNotepad.empty();
    const title = notepad.addNote(undefined, "Title");
    const page = notepad.addNote(title.id, "Page");
    notepad.setNoteContent(page.id, {
      type: "noteDoc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "one" }] },
        { type: "paragraph", content: [{ type: "text", text: "two" }] },
      ],
    });

    const element = createDiv();
    document.body.appendChild(element);
    const editor = new Editor({
      element,
      content: {
        type: "noteDoc",
        content: [
          { type: "noteTitle", content: [{ type: "text", text: "T" }] },
          { type: "paragraph", attrs: { id: "deadbeef01" }, content: [{ type: "text", text: "one" }] },
          { type: "paragraph", attrs: { id: "deadbeef01" }, content: [{ type: "text", text: "two" }] },
        ],
      },
      extensions: getExtensions(),
      editable: true,
    });

    const tmpWrites: Uint8Array[] = [];
    const view = new NotepadView(new WorkspaceLeaf() as never);
    const v = view as unknown as Record<string, unknown>;
    v.app = {
      vault: {
        adapter: {
          // No getFullPath: replaceFile must take the adapter.rename
          // branch (the node-fs fast path would touch the real disk).
          stat: async () => null,
          writeBinary: async (path: string, data: ArrayBuffer) => {
            if (path.includes(".tmp")) tmpWrites.push(new Uint8Array(data));
          },
          rename: async () => {},
          remove: async () => {},
          append: async () => {},
          read: async () => "",
          readBinary: async () => new Uint8Array(),
          exists: async () => false,
          mkdir: async () => {},
        },
        on: () => () => {},
      },
      workspace: { on: () => () => {} },
    };
    v.file = new TFile("test.um");
    v.notepad = notepad;
    v.sections = new Map([["page-under-test", { id: page.id, editor }]]);
    (view as unknown as { saveTimer: null }).saveTimer = null;

    await (
      view as unknown as {
        writePendingChanges(trigger: string, force: boolean): Promise<void>;
      }
    ).writePendingChanges("test-pin", true);

    // The model no longer carries the duplicate...
    const modelIds: string[] = [];
    walkIds(notepad.noteContent(page.id)!, modelIds);
    expect(modelIds).toHaveLength(3);
    expect(new Set(modelIds).size).toBe(3);

    // ...and the serialized container bytes are duplicate-free too.
    expect(tmpWrites.length).toBeGreaterThan(0);
    const reparsed = UmNotepad.fromBytes(tmpWrites[0]);
    const writtenIds: string[] = [];
    walkIds(reparsed.noteContent(page.id)!, writtenIds);
    expect(writtenIds).toHaveLength(3);
    expect(new Set(writtenIds).size).toBe(3);
    editor.destroy();
    element.remove();
  });
});
