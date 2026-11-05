import { describe, expect, it, vi } from "vitest";
import { NotepadView } from "../NotepadView";

/**
 * Wiring of the pre-write external-change gate (issues/um-external-change-
 * watch, PR #22 CR-22-03): `writePendingChanges` must consult the disk
 * fingerprint before every real write and obey the decision. The pure
 * decision is resolveExternalWrite (own test file) — this suite pins the
 * view's wiring around it.
 */

type AnyView = Record<string, unknown> & {
  writePendingChanges: (
    trigger: string,
    force?: boolean,
    bypassExternalCheck?: boolean,
  ) => Promise<void>;
};

interface Harness {
  view: AnyView;
  stat: ReturnType<typeof vi.fn>;
  writeBinary: ReturnType<typeof vi.fn>;
  rename: ReturnType<typeof vi.fn>;
  openModal: ReturnType<typeof vi.fn>;
  notepad: {
    dirtyNotes: Set<string>;
    structureChanged: boolean;
    savedFingerprint: string | null;
    serialize: () => Uint8Array;
    notes: () => Array<{ id: string }>;
  };
}

/** A NotepadView skeleton with just the fields writePendingChanges reads —
 *  the real view needs a leaf/app; the wiring under test only touches the
 *  save path and the gate. */
function build(harness?: Partial<Harness>): Harness {
  const stat = vi.fn(
    async () => ({ mtime: 100, size: 10 }) as { mtime: number; size: number },
  );
  const writeBinary = vi.fn(async () => {});
  const rename = vi.fn(async () => {});
  const openModal = vi.fn();
  const notepad = harness?.notepad ?? {
    dirtyNotes: new Set<string>(["p1"]),
    structureChanged: false,
    savedFingerprint: "100:10",
    serialize: () => new Uint8Array([1]),
    notes: () => [{ id: "p1" }],
    // fixBlockIdConflicts walks openable pages for stored-id repairs.
    isNoteOpenable: () => false,
    noteContent: () => null,
  };
  const view = Object.create(NotepadView.prototype) as AnyView;
  Object.assign(view, {
    notepad,
    file: { path: "local/x.um", name: "x.um", stat: { size: 10 } },
    app: { vault: { adapter: { stat, writeBinary, rename } } },
    saveChain: Promise.resolve(),
    saveTimer: null,
    dirty: true,
    conflictModalOpen: false,
    sections: new Map(),
    // Nav/comments side effects are out of this suite's scope.
    syncNavTitles: () => {},
    refreshCommentsModels: () => {},
    openConflictModal: openModal,
    ...harness?.view,
  });
  return {
    view,
    stat,
    writeBinary,
    rename,
    openModal,
    notepad: notepad as Harness["notepad"],
  };
}

describe("writePendingChanges wiring of the external-write gate", () => {
  it("writes when the disk matches the last reflected state", async () => {
    const h = build();
    await h.view.writePendingChanges("autosave");
    expect(h.writeBinary).toHaveBeenCalledTimes(1);
    expect(h.notepad.dirtyNotes.size).toBe(0);
  });

  it("blocks the write on an unobserved external change with a dialog open", async () => {
    const h = build();
    h.stat.mockResolvedValue({ mtime: 999, size: 99 }); // disk drifted
    (h.view.conflictModalOpen as boolean) = true;
    await h.view.writePendingChanges("autosave");
    expect(h.writeBinary).not.toHaveBeenCalled();
    // The blocked flush stays retriable: dirty flags intact.
    expect(h.notepad.dirtyNotes.size).toBe(1);
    expect(h.openModal).not.toHaveBeenCalled();
  });

  it("raises the conflict dialog on an unobserved external change", async () => {
    const h = build();
    h.stat.mockResolvedValue({ mtime: 999, size: 99 });
    await h.view.writePendingChanges("autosave");
    expect(h.openModal).toHaveBeenCalledTimes(1);
    expect(h.writeBinary).not.toHaveBeenCalled();
    expect(h.notepad.dirtyNotes.size).toBe(1);
  });

  it("never raises UI from a teardown flush — it just skips the write", async () => {
    const h = build();
    h.stat.mockResolvedValue({ mtime: 999, size: 99 });
    await h.view.writePendingChanges("close");
    expect(h.writeBinary).not.toHaveBeenCalled();
    expect(h.openModal).not.toHaveBeenCalled();
    expect(h.notepad.dirtyNotes.size).toBe(1);
  });

  it("writes through the drifted disk only with the explicit keep-local bypass", async () => {
    const h = build();
    h.stat.mockResolvedValue({ mtime: 999, size: 99 });
    await h.view.writePendingChanges("conflict-keep-local", true, true);
    expect(h.writeBinary).toHaveBeenCalledTimes(1);
    expect(h.openModal).not.toHaveBeenCalled();
    expect(h.notepad.dirtyNotes.size).toBe(0);
  });

  it("skips the gate entirely when there is nothing to write", async () => {
    const h = build();
    h.notepad.dirtyNotes.clear();
    await h.view.writePendingChanges("autosave");
    expect(h.stat).not.toHaveBeenCalled();
    expect(h.writeBinary).not.toHaveBeenCalled();
  });
});
