import { createRequire } from "node:module";
import os from "node:os";
import { describe, expect, it, vi } from "vitest";
import { NotepadView } from "../NotepadView";
import { LEASE_SUFFIX, LOCK_SUFFIX } from "../storage/umLock";
import { UmNotepad } from "../storage/um/umNotepad";

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
const shimStore = new Map<string, string>();
let fdSeq = 1;
const openFds = new Map<number, { path: string }>();
const fsShim = {
  renameSync: () => {},
  openSync: (path: string, _flags: string) => {
    if (shimStore.has(path)) {
      const err = new Error("EEXIST") as Error & { code?: string };
      err.code = "EEXIST";
      throw err;
    }
    const fd = fdSeq++;
    openFds.set(fd, { path });
    return fd;
  },
  writeSync: (fd: number, data: string) => {
    const entry = openFds.get(fd);
    if (entry != null) shimStore.set(entry.path, data);
    return data.length;
  },
  closeSync: (fd: number) => {
    openFds.delete(fd);
  },
  chmodSync: () => {},
};

(window as unknown as { require?: (id: string) => unknown }).require = (id: string) => {
  if (id === "fs") return fsShim;
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
  reloadFromDisk: () => Promise<void>;
  lease: { sync(): Promise<void>; release(): Promise<void>; currentOpId(): string | null };
};

interface Harness {
  view: AnyView;
  stat: ReturnType<typeof vi.fn>;
  read: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  writeBinary: ReturnType<typeof vi.fn>;
  rename: ReturnType<typeof vi.fn>;
  files: Map<string, string>;
  openModal: ReturnType<typeof vi.fn>;
  scheduleSave: ReturnType<typeof vi.fn>;
  notepad: { dirtyNotes: Set<string>; structureChanged: boolean; savedFingerprint: string | null };
}

function build(sidecars: Record<string, string> = {}): Harness {
  // The adapter and the fs shim share one store, so the lease lifecycle
  // (acquire via fs O_EXCL, release/remove) observes real file effects.
  shimStore.clear();
  for (const [k, v] of Object.entries(sidecars)) shimStore.set(k, v);
  const stat = vi.fn(async (path: string) => {
    if (shimStore.has(path)) return { mtime: Date.now() - 500, size: (shimStore.get(path) as string).length };
    // Real-adapter shape: only the document stats to something; any other
    // path (an absent sidecar) is null → the gate reads it as absent.
    if (path === FILE) return { mtime: 100, size: 10 } as { mtime: number; size: number };
    return null;
  });
  const read = vi.fn(async (path: string) => {
    if (shimStore.has(path)) return shimStore.get(path) as string;
    throw new Error("missing");
  });
  const remove = vi.fn(async (path: string) => {
    shimStore.delete(path);
  });
  const writeBinary = vi.fn(async (_path: string, _data: ArrayBuffer) => {});
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
    destroy: () => {},
  };
  const view = Object.create(NotepadView.prototype) as AnyView;
  Object.assign(view, {
    notepad,
    file: { path: "local/x.um", name: "x.um", stat: { size: 10 } },
    app: {
      vault: {
        adapter: { stat, read, remove, writeBinary, rename, getFullPath: (p: string) => p },
        readBinary: async () => UmNotepad.empty().serialize().slice().buffer,
      },
    },
    saveChain: Promise.resolve(),
    saveTimer: null,
    dirty: true,
    conflictModalOpen: false,
    sections: new Map(),
    syncNavTitles: () => {},
    refreshCommentsModels: () => {},
    refreshCommentsUI: () => {},
    destroyAllSections: () => {},
    render: () => {},
    restoreNotepadUiState: async () => {},
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
    files: shimStore,
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

  it("teardown flush rescues on defer too (fresh cross-host blocker)", async () => {
    const crossHost = { kind: "cli", pid: 424242, hostname: "other.machine" };
    const h = build({ [LOCK_PATH]: sidecarJson(crossHost, "lock") });
    await h.view.writePendingChanges("close");
    // A fresh cross-host sidecar outlives the bounded teardown wait — the
    // rescue must fire for defer as well, not only for conflict.
    expect(h.writeBinary).toHaveBeenCalledTimes(1);
    expect(h.writeBinary.mock.calls[0][0]).toMatch(/^local\/\.x\.um\..*\.tmp$/);
    expect(h.rename).not.toHaveBeenCalled();
    expect(h.openModal).not.toHaveBeenCalled();
    expect(h.scheduleSave).not.toHaveBeenCalled();
  }, 10_000);

  it("an edit landing during the write keeps the lease; a clean flush releases it", async () => {
    const h = build();
    await h.view.lease.sync();
    expect(h.files.has(LEASE_PATH)).toBe(true);
    h.writeBinary.mockImplementationOnce(async () => {
      h.notepad.dirtyNotes.add("p2"); // an edit lands during the disk wait
    });
    await h.view.writePendingChanges("autosave");
    // The newer edits are unsaved — the lease must stay.
    expect(h.files.has(LEASE_PATH)).toBe(true);
    h.notepad.dirtyNotes.clear();
    await h.view.writePendingChanges("autosave"); // the follow-up flush, clean
    expect(h.files.has(LEASE_PATH)).toBe(false);
  });

  it("an ordinary successful autosave releases the lease (saved notepad must not stay locked)", async () => {
    const h = build();
    await h.view.lease.sync();
    expect(h.files.has(LEASE_PATH)).toBe(true);
    await h.view.writePendingChanges("autosave");
    expect(h.files.has(LEASE_PATH)).toBe(false);
  });

  it("reloadFromDisk releases the dirty lease (clean notepad must not stay locked)", async () => {
    const h = build();
    await h.view.lease.sync();
    expect(h.files.has(LEASE_PATH)).toBe(true);
    await h.view.reloadFromDisk();
    expect(h.files.has(LEASE_PATH)).toBe(false);
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
