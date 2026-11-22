import { describe, it, expect, afterEach, beforeAll } from "vitest";
import type { Transaction } from "prosemirror-state";
import { Editor } from "../../core/Editor";
import { getExtensions } from "../../getExtensions";
import { VIEW_TAG, keyToPos, quickDropFiles } from "./attachment";
import type { AttachmentElementType } from "./attachment";

/**
 * Dismiss-path branches of the quick-drop attach flow (external file
 * drop → chip → link-or-copy dialog → cancel). Mounted through the real
 * Editor (getExtensions) like attachment.click-gate.test.ts so the
 * auto-trigger, keyToPos mapping and the transaction metadata all run.
 *
 * Chips are inserted by a transaction after mount, mirroring the real
 * drop: the nodeState plugin's init deletes data-less attachment nodes
 * from parsed initial content (interrupted-upload leftover policy), so a
 * fresh quick-drop chip can only exist in a live session.
 */

/** Obsidian patches these helpers onto HTMLElement; jsdom has none. */
beforeAll(() => {
  const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
  proto["addClass"] ??= function (this: HTMLElement, cls: string) {
    this.classList.add(cls);
  };
  proto["removeClass"] ??= function (this: HTMLElement, cls: string) {
    this.classList.remove(cls);
  };
  const doc = document as unknown as {
    elementFromPoint?: (x: number, y: number) => Element | null;
  };
  doc.elementFromPoint ??= () => null;
});

function makeFile(name: string): File {
  return new File([new Uint8Array(8)], name, { type: "application/pdf" });
}

type UpdateFn = (attrs: Record<string, unknown>) => void;

describe("attachment quick-drop dismiss branches", () => {
  let editor: Editor | null = null;
  let host: HTMLElement | null = null;

  afterEach(() => {
    editor?.destroy();
    host?.remove();
    editor = null;
    host = null;
    quickDropFiles.clear();
    // keyToPos is module-level too: a stale key → position entry from one
    // test would let a later restore loop (setAttachmentViewProps) adopt it.
    keyToPos.clear();
  });

  /** Mount a plain editor; the hook only captures the flow callbacks into
   *  the returned live object (a later trigger re-captures). */
  function mount(): { cancel: () => void; update: UpdateFn } {
    const refs: { cancel: () => void; update: UpdateFn } = {
      cancel: () => {},
      update: () => {},
    };
    host = createDiv();
    document.body.appendChild(host);
    editor = new Editor({
      element: host,
      content: {
        type: "noteDoc",
        content: [
          { type: "noteTitle", content: [{ type: "text", text: "Title" }] },
          { type: "paragraph", content: [{ type: "text", text: "Before" }] },
          { type: "paragraph", content: [{ type: "text", text: "After" }] },
        ],
      },
      extensions: getExtensions({
        attachment: {
          onFileSelected: (_file, updateFn, cancelFn) => {
            refs.update = updateFn;
            refs.cancel = cancelFn;
          },
        },
      }),
      editable: true,
    });
    return refs; // live object — late triggers re-capture on the same refs
  }

  /** Insert a chip the way the drop handler does: park the file first,
   *  then create the node with the key and the quick-drop flag. */
  function insertChip(attrs: Record<string, unknown>, parkKey?: string): void {
    if (parkKey != null) {
      quickDropFiles.set(parkKey, makeFile("dropped.pdf"));
    }
    const node = editor!.state.schema.nodes.attachment.create(attrs);
    let insertAt = -1;
    editor!.state.doc.descendants((n, pos) => {
      if (insertAt < 0 && n.type.name === "paragraph") {
        insertAt = pos + n.nodeSize;
        return false;
      }
      return true;
    });
    editor!.view.dispatch(editor!.state.tr.insert(insertAt, node));
  }

  function chipElement(): AttachmentElementType {
    const element = host!.querySelector(VIEW_TAG) as AttachmentElementType;
    expect(element).not.toBeNull();
    return element;
  }

  /** Record every dispatched transaction so the dismiss branch's meta is
   *  observable (install after the insert to isolate the dismiss). */
  function recordDispatches(): Transaction[] {
    const dispatches: Transaction[] = [];
    const view = editor!.view as unknown as {
      dispatch: (tr: Transaction) => void;
    };
    const original = view.dispatch.bind(view);
    view.dispatch = (tr: Transaction) => {
      dispatches.push(tr);
      original(tr);
    };
    return dispatches;
  }

  function attachmentNode(): { pos: number; attrs: Record<string, unknown> } | null {
    let found: { pos: number; attrs: Record<string, unknown> } | null = null;
    editor!.state.doc.descendants((n, pos) => {
      if (found == null && n.type.name === "attachment") {
        found = { pos, attrs: n.attrs };
        return false;
      }
      return true;
    });
    return found;
  }

  it("a fresh quick-drop chip with a live parked file is removed on dismiss, outside undo history", () => {
    const flow = mount();
    insertChip({ key: "qd_live", state: { isQuickDrop: true } }, "qd_live");
    expect(attachmentNode()).not.toBeNull();
    expect(quickDropFiles.has("qd_live")).toBe(true);

    const dispatches = recordDispatches();
    flow.cancel();

    expect(attachmentNode()).toBeNull();
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0].getMeta("addToHistory")).toBe(false);
    // the parked file is released with the chip
    expect(quickDropFiles.has("qd_live")).toBe(false);
  });

  it("a non-quick-drop chip with preparedData survives dismiss, preparedData cleared", () => {
    const flow = mount();
    insertChip({
      key: "pd_chip",
      state: { preparedData: { file: makeFile("picked.pdf") } },
    });

    const dispatches = recordDispatches();
    flow.cancel();

    const chip = attachmentNode();
    expect(chip).not.toBeNull();
    const state = chip!.attrs.state as
      | { preparedData?: { file?: File } }
      | null;
    expect(state?.preparedData).toBeUndefined();
    expect(dispatches).toHaveLength(1);
    expect(dispatches[0].getMeta("addToHistory")).toBe(false);
  });

  it("a mapped position pointing at another block does not delete anything", () => {
    const flow = mount();
    insertChip({ key: "qd_moved", state: { isQuickDrop: true } }, "qd_moved");
    // Replace the chip with a paragraph: keyToPos maps the key onto the
    // new block, so a blind dismiss would delete the wrong node.
    const chip = attachmentNode()!;
    const size = editor!.state.doc.nodeAt(chip.pos)!.nodeSize;
    const paragraph = editor!.state.schema.nodes.paragraph.create(
      null,
      editor!.state.schema.text("replaced"),
    );
    editor!.view.dispatch(
      editor!.state.tr.replaceWith(chip.pos, chip.pos + size, paragraph),
    );
    expect(attachmentNode()).toBeNull();

    const dispatches = recordDispatches();
    flow.cancel();

    // The dismiss resolved into a no-op: the mapped position holds the
    // paragraph, not this chip — nothing was deleted, nothing dispatched.
    expect(dispatches).toHaveLength(0);
    const text = editor!.state.doc.textBetween(
      0,
      editor!.state.doc.content.size,
      "\n",
    );
    expect(text).toContain("replaced");
  });

  it("a chip with data.id (attached) takes the restore path, not deletion", () => {
    const flow = mount();
    insertChip({
      key: "attached_chip",
      data: { id: "docs/file.pdf", filename: "file.pdf" },
      state: { preparedData: { file: makeFile("b.pdf") } },
    });

    flow.cancel();

    const chip = attachmentNode();
    expect(chip).not.toBeNull();
    expect((chip!.attrs.data as { id?: string }).id).toBe("docs/file.pdf");
    const state = chip!.attrs.state as { preparedData?: { file?: File } } | null;
    expect(state?.preparedData).toBeUndefined();
  });

  it("a chip with the quick-drop flag but no parked file is not deleted on dismiss", () => {
    const flow = mount();
    // No quickDropFiles entry — the state a chip reloaded from JSON would
    // be in (its parsed content is in fact dropped at open by the
    // nodeState init cleanup): the flag alone must never enable deletion.
    insertChip({ key: "qd_orphan", state: { isQuickDrop: true } });
    // Drive the chip's own picker path — the only way this orphaned chip
    // can reach a dialog — then cancel that flow.
    chipElement().props.onFileSelected(makeFile("picked.pdf"));
    const dispatches = recordDispatches();
    flow.cancel();

    const chip = attachmentNode();
    expect(chip).not.toBeNull();
    const state = chip!.attrs.state as { preparedData?: { file?: File } } | null;
    expect(state?.preparedData).toBeUndefined();
    expect(dispatches).toHaveLength(1);
  });

  it("the two-phase settle path delivers data and keeps the key stable", () => {
    const flow = mount();
    insertChip({ key: "qd_settle", state: { isQuickDrop: true } }, "qd_settle");

    // Phase 1 (the dialog copy started): loading state, no data yet.
    flow.update({
      state: {
        fileStatus: "loading",
        text: "dropped.pdf",
        subtext: "",
        preparedData: undefined,
      },
      data: undefined,
    });
    // Phase 2 (the vault copy finished): the result must land on the SAME
    // node under the SAME key. A key reset in phase 1 (setNodeMarkup
    // without the current key) makes nodeState regenerate it before this
    // phase, whose dispatch then fails the identity guard and strands the
    // chip in "Loading…" with the file already written to the vault.
    flow.update({
      state: {
        fileStatus: "attached",
        text: "dropped.pdf",
        subtext: "",
        preparedData: undefined,
      },
      data: { id: "f1", size: "8", filename: "dropped.pdf" },
    });

    const chip = attachmentNode();
    expect(chip).not.toBeNull();
    // the attach result reached the node
    expect((chip!.attrs.data as { id?: string }).id).toBe("f1");
    // no key regeneration between the phases
    expect(chip!.attrs.key).toBe("qd_settle");
    // the settled flow consumed the parked file
    expect(quickDropFiles.has("qd_settle")).toBe(false);
  });

  it("destroying the editor releases the parked quick-drop file", () => {
    mount();
    insertChip(
      { key: "qd_destroy", state: { isQuickDrop: true } },
      "qd_destroy",
    );
    expect(quickDropFiles.has("qd_destroy")).toBe(true);

    // Dispose without an attach result: the node view's destroy is the
    // leak net — the entry must not outlive the editor.
    editor!.destroy();
    editor = null; // afterEach would double-destroy

    expect(quickDropFiles.has("qd_destroy")).toBe(false);
  });
});
