import { describe, expect, it } from "vitest";
// Direct mock import: the runtime mock's TFile takes a path (the real
// obsidian.d.ts declares a 0-arg constructor).
import { TFile, WorkspaceLeaf } from "../__mocks__/obsidian";

import { NotepadView } from "../NotepadView";
import { UmNotepad } from "../storage/um/umNotepad";
import { assignBlockIds, isBlockId } from "../texto/extensions/block-ids";
import type { JSONContent } from "../texto/core/@types";

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
