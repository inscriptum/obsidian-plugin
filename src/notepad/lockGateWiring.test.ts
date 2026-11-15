import { createRequire } from "node:module";
import os from "node:os";
import { describe, expect, it, vi } from "vitest";
import { NotepadView } from "../NotepadView";
import { LEASE_SUFFIX, LOCK_SUFFIX } from "../storage/umLock";

/**
 * Wiring of the lock-protocol gate (issues/um-lock-lease) into the
 * notepad save path: writePendingChanges must consult both sidecars
 * before every real write and obey the decision. The verdict matrix is
 * pinned by umLock.test.ts — this suite pins the view's wiring around it.
 *
 * "Live" holders use the test runner's own pid (same host, provably
 * alive), so no liveness injection is needed. jsdom has no window.require,
 * so the view would run with the NULL host (age-based verdicts) — the shim
 * below restores the real os module, exactly the desktop configuration.
 */

const req = createRequire(import.meta.url);
(window as unknown as { require?: (id: string) => unknown }).require = (id: string) => {
  if (id === "fs") return { renameSync: () => {} }; // never reached: the fake adapter has no getFullPath
  return req(id);
};
// Desktop reality: with node integration the renderer exposes process on
// the window; the jsdom runner only has it as a node global.
(window as unknown as { process?: unknown }).process = process;

const LIVE_HOLDER = { kind: "cli", pid: process.pid, hostname: os.hostname() };
const DEAD_HOLDER = { kind: "cli", pid: 999_999_999, hostname: os.hostname() };

function sidecarJson(holder: typeof LIVE_HOLDER, kind = "lock"): string {
  return JSON.stringify({
    format: 1,
    kind,
    holder,
    op_id: "abcdef014242",
    created_at: Date.now() - 500, // fresh: age-based decay does not fire
    purpose: "test",
  });
}

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
  read: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  writeBinary: ReturnType<typeof vi.fn>;
  rename: ReturnType<typeof vi.fn>;
  openModal: ReturnType<typeof vi.fn>;
  scheduleSave: ReturnType<typeof vi.fn>;
  notepad: { dirtyNotes: Set<string>; structureChanged: boolean; savedFingerprint: string | null };
}

function build(sidecars: Record<string, string> = {}): Harness {
  const stat = vi.fn(async (path: string) => {
    if (path in sidecars) return { mtime: Date.now() - 500, size: sidecars[path].length };
    // Real-adapter shape: only the document stats to something; any other
    // path (an absent sidecar) is null → the gate reads it as absent.
    if (path === FILE) return { mtime: 100, size: 10 } as { mtime: number; size: number };
    return null;
  });
  const read = vi.fn(async (path: string) => {
    if (path in sidecars) return sidecars[path];
    throw new Error("missing");
  });
  const remove = vi.fn(async (path: string) => {});
  const writeBinary = vi.fn(async () => {});
  const rename = vi.fn(async () => {});
  const openModal = vi.fn();
  const scheduleSave = vi.fn();
  const notepad = {
    dirtyNotes: new Set<string>(["p1"]),
    structureChanged: false,
    savedFingerprint: "100:10",
    serialize: () => new Uint8Array([1]),
    notes: () => [{ id: "p1" }],
    isNoteOpenable: () => false,
    noteContent: () => null,
  };
  const view = Object.create(NotepadView.prototype) as AnyView;
  Object.assign(view, {
    notepad,
    file: { path: "local/x.um", name: "x.um", stat: { size: 10 } },
    app: { vault: { adapter: { stat, read, remove, writeBinary, rename } } },
    saveChain: Promise.resolve(),
    saveTimer: null,
    dirty: true,
    conflictModalOpen: false,
    sections: new Map(),
    syncNavTitles: () => {},
    refreshCommentsModels: () => {},
    openConflictModal: openModal,
    scheduleSave,
  });
  return {
    view,
    stat,
    read,
    remove,
    writeBinary,
    rename,
    openModal,
    scheduleSave,
    notepad: notepad as Harness["notepad"],
  };
}

const FILE = "local/x.um";
const LOCK_PATH = `local/.x.um${LOCK_SUFFIX}`;
const LEASE_PATH = `local/.x.um${LEASE_SUFFIX}`;

describe("writePendingChanges wiring of the lock gate", () => {
  it("defers on a live foreign commit lock and schedules a retry", async () => {
    const h = build({ [LOCK_PATH]: sidecarJson(LIVE_HOLDER, "lock") });
    await h.view.writePendingChanges("autosave");
    expect(h.writeBinary).not.toHaveBeenCalled();
    expect(h.scheduleSave).toHaveBeenCalledTimes(1);
    expect(h.openModal).not.toHaveBeenCalled();
    // The flush stays retriable: dirty flags intact.
    expect(h.notepad.dirtyNotes.size).toBe(1);
  });

  it("raises the conflict dialog on a live foreign dirty lease", async () => {
    const h = build({ [LEASE_PATH]: sidecarJson(LIVE_HOLDER, "lease") });
    await h.view.writePendingChanges("autosave");
    expect(h.writeBinary).not.toHaveBeenCalled();
    expect(h.openModal).toHaveBeenCalledTimes(1);
    expect(h.scheduleSave).not.toHaveBeenCalled();
    expect(h.notepad.dirtyNotes.size).toBe(1);
  });

  it("breaks a stale (dead-holder) lease and proceeds with the write", async () => {
    const h = build({ [LEASE_PATH]: sidecarJson(DEAD_HOLDER, "lease") });
    await h.view.writePendingChanges("autosave");
    expect(h.remove).toHaveBeenCalledWith(LEASE_PATH);
    expect(h.writeBinary).toHaveBeenCalledTimes(1);
    expect(h.notepad.dirtyNotes.size).toBe(0);
  });

  it("never bypasses the lock gate, even with the keep-local external bypass", async () => {
    const h = build({ [LEASE_PATH]: sidecarJson(LIVE_HOLDER, "lease") });
    await h.view.writePendingChanges("conflict-keep-local", true, true);
    expect(h.writeBinary).not.toHaveBeenCalled();
    expect(h.openModal).toHaveBeenCalledTimes(1);
  });

  it("rescues dirty content to a temp copy on a teardown flush blocked by a live lease", async () => {
    const h = build({ [LEASE_PATH]: sidecarJson(LIVE_HOLDER, "lease") });
    await h.view.writePendingChanges("close");
    // The recovery rescue parks the serialized notepad in a .tmp copy —
    // the real write (which would rename over the file) never happened.
    expect(h.writeBinary).toHaveBeenCalledTimes(1);
    expect(h.writeBinary.mock.calls[0][0]).toMatch(/^local\/\.x\.um\..*\.tmp$/);
    expect(h.rename).not.toHaveBeenCalled();
    expect(h.openModal).not.toHaveBeenCalled();
    expect(h.scheduleSave).not.toHaveBeenCalled();
    expect(h.notepad.dirtyNotes.size).toBe(1);
  }, 10_000);

  it("does not consult the gate when there is nothing to write", async () => {
    const h = build({ [LEASE_PATH]: sidecarJson(LIVE_HOLDER, "lease") });
    h.notepad.dirtyNotes.clear();
    await h.view.writePendingChanges("autosave");
    expect(h.read).not.toHaveBeenCalled();
    expect(h.writeBinary).not.toHaveBeenCalled();
  });

  it("mobile (no node host): the gate never runs — no sidecar IO, plain save", async () => {
    // Strip the desktop shims: without window.require/window.process the
    // view detects the NULL host (mobile) and skips the whole protocol.
    const win = window as unknown as { require?: unknown; process?: unknown };
    const savedRequire = win.require;
    const savedProcess = win.process;
    win.require = undefined;
    win.process = undefined;
    try {
      const h = build({ [LEASE_PATH]: sidecarJson(LIVE_HOLDER, "lease") });
      await h.view.writePendingChanges("autosave");
      // The sidecar that WOULD block a desktop save was never even read.
      expect(h.read).not.toHaveBeenCalled();
      expect(h.remove).not.toHaveBeenCalled();
      expect(h.writeBinary).toHaveBeenCalledTimes(1);
    } finally {
      win.require = savedRequire;
      win.process = savedProcess;
    }
  });

  it("writes when both sidecars are absent (the plain autosave path)", async () => {
    const h = build();
    await h.view.writePendingChanges("autosave");
    expect(h.writeBinary).toHaveBeenCalledTimes(1);
    expect(h.remove).not.toHaveBeenCalled();
  });
});
