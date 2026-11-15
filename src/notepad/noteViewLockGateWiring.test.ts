import { createRequire } from "node:module";
import os from "node:os";
import { describe, expect, it, vi } from "vitest";
import { LEASE_SUFFIX, LOCK_SUFFIX } from "../storage/umLock";

/**
 * Wiring of the lock-protocol gate (issues/um-lock-lease) into the NoteView
 * (.note) save path — the .um side is pinned by lockGateWiring.test.ts;
 * this suite pins that flushSave consults both sidecars and obeys the
 * decision before touching the file.
 */

vi.mock("../storage/noteStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../storage/noteStorage")>();
  return {
    ...actual,
    writeNote: vi.fn(async () => {}),
    logDiagEvent: vi.fn(async () => {}),
  };
});

const { NoteView } = await import("../NoteView");
const { writeNote } = await import("../storage/noteStorage");
import { UmNotepad } from "../storage/um/umNotepad";

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
(window as unknown as { process?: unknown }).process = process;

const LIVE_HOLDER = { kind: "cli", pid: process.pid, hostname: os.hostname() };
const DEAD_HOLDER = { kind: "cli", pid: 999_999_999, hostname: os.hostname() };

function sidecarJson(holder: typeof LIVE_HOLDER, kind = "lock"): string {
  return JSON.stringify({
    format: 1,
    kind,
    holder,
    op_id: "abcdef014242",
    created_at: Date.now() - 500,
    purpose: "test",
  });
}

const FILE = "local/y.note";
const LOCK_PATH = `local/.y.note${LOCK_SUFFIX}`;
const LEASE_PATH = `local/.y.note${LEASE_SUFFIX}`;

function build(sidecars: Record<string, string> = {}) {
  // The adapter and the fs shim share one store, so the lease lifecycle
  // (acquire via fs O_EXCL, release/remove) observes real file effects.
  shimStore.clear();
  for (const [k, v] of Object.entries(sidecars)) shimStore.set(k, v);
  const stat = vi.fn(async (path: string) => {
    if (path === FILE) return { mtime: 100, size: 10 };
    if (shimStore.has(path)) return { mtime: Date.now() - 500, size: (shimStore.get(path) as string).length };
    return null;
  });
  const read = vi.fn(async (path: string) => {
    if (shimStore.has(path)) return shimStore.get(path) as string;
    throw new Error("missing");
  });
  const remove = vi.fn(async (path: string) => {
    shimStore.delete(path);
  });
  const write = vi.fn(async (path: string, data: string) => {
    shimStore.set(path, data);
  });
  const readBinary = vi.fn(async () => UmNotepad.empty().serialize().slice().buffer);
  const openModal = vi.fn();
  const scheduleSave = vi.fn();
  const view = Object.create(NoteView.prototype) as Record<string, unknown> & {
    flushSave: (trigger?: string) => Promise<void>;
    overwriteFileFromEditor: () => Promise<void>;
    applyExternalContent: (raw: string) => Promise<void>;
    lease: { sync(): Promise<void>; release(): Promise<void>; currentOpId(): string | null };
  };
  Object.assign(view, {
    editor: {
      getJSON: () => ({ type: "doc" }),
      isDestroyed: false,
      commands: { setContent: () => {} },
    },
    file: { path: FILE, name: "y.note", stat: { size: 10 } },
    app: {
      vault: {
        adapter: { stat, read, remove, write, getFullPath: (p: string) => p },
        readBinary,
        read: async () => "",
      },
    },
    dirty: true,
    conflictModalOpen: false,
    syncedRaw: null,
    applyingRemoteChange: false,
    fixDuplicateBlockIds: () => {},
    blockEmptyOverwrite: async () => false,
    renameToTitleIfNeeded: async () => {},
    logDiag: vi.fn(),
    openConflictModalWith: openModal,
    scheduleSave,
  });
  // The writeNote mock is module-level and shared across tests — reset its
  // call history per build so the per-test counts stay independent.
  (writeNote as ReturnType<typeof vi.fn>).mockClear();
  return { view, stat, read, remove, write, files: shimStore, openModal, scheduleSave, writeNote: writeNote as ReturnType<typeof vi.fn> };
}

describe("NoteView flushSave wiring of the lock gate", () => {
  it("defers on a live foreign commit lock and schedules a retry", async () => {
    const h = build({ [LOCK_PATH]: sidecarJson(LIVE_HOLDER, "lock") });
    await h.view.flushSave("autosave");
    expect(h.writeNote).not.toHaveBeenCalled();
    expect(h.scheduleSave).toHaveBeenCalledTimes(1);
    expect(h.openModal).not.toHaveBeenCalled();
    expect(h.view.dirty).toBe(true);
  });

  it("raises the conflict dialog on a live foreign dirty lease", async () => {
    const h = build({ [LEASE_PATH]: sidecarJson(LIVE_HOLDER, "lease") });
    await h.view.flushSave("autosave");
    expect(h.writeNote).not.toHaveBeenCalled();
    expect(h.openModal).toHaveBeenCalledTimes(1);
    expect(h.view.dirty).toBe(true);
  });

  it("breaks a stale (dead-holder) lease and proceeds with the write", async () => {
    const h = build({ [LEASE_PATH]: sidecarJson(DEAD_HOLDER, "lease") });
    await h.view.flushSave("autosave");
    expect(h.remove).toHaveBeenCalledWith(LEASE_PATH);
    expect(h.writeNote).toHaveBeenCalledTimes(1);
    expect(h.view.dirty).toBe(false);
  });

  it("teardown flush rescues on defer too (fresh cross-host blocker)", async () => {
    const crossHost = { kind: "cli", pid: 424242, hostname: "other.machine" };
    const h = build({ [LOCK_PATH]: sidecarJson(crossHost, "lock") });
    await h.view.flushSave("close");
    // A fresh cross-host sidecar outlives the bounded teardown wait — the
    // rescue branch must fire for defer as well, not only conflict.
    expect(h.write).toHaveBeenCalledTimes(1);
    expect(h.write.mock.calls[0][0]).toMatch(/^local\/\.y\.note\..*\.tmp$/);
    expect(h.writeNote).not.toHaveBeenCalled();
    expect(h.openModal).not.toHaveBeenCalled();
    expect(h.scheduleSave).not.toHaveBeenCalled();
  }, 10_000);

  it("an edit landing during the write keeps the lease; a clean save releases it", async () => {
    const h = build();
    h.view.dirty = true;
    await h.view.lease.sync();
    expect(h.files.has(LEASE_PATH)).toBe(true);
    (h.writeNote as ReturnType<typeof vi.fn>).mockImplementationOnce(async () => {
      h.view.dirty = true; // onUpdate fired while the disk write was in flight
    });
    await h.view.flushSave("autosave");
    // The newer edits are unsaved — releasing here would leave them
    // unprotected until the next keystroke.
    expect(h.files.has(LEASE_PATH)).toBe(true);
    await h.view.flushSave("autosave"); // the follow-up flush, clean
    expect(h.files.has(LEASE_PATH)).toBe(false);
  });

  it("loading the disk version releases the dirty lease", async () => {
    const h = build();
    h.view.dirty = true;
    await h.view.lease.sync();
    expect(h.files.has(LEASE_PATH)).toBe(true);
    await h.view.applyExternalContent(JSON.stringify({ type: "doc", content: [] }));
    // The editor now mirrors the disk — a live holder for a clean doc
    // would make the CLI refuse writes forever.
    expect(h.files.has(LEASE_PATH)).toBe(false);
    expect(h.view.dirty).toBe(false);
  });

  it("mobile (no node host): the gate never runs — no sidecar IO, plain save", async () => {
    const win = window as unknown as { require?: unknown; process?: unknown };
    const savedRequire = win.require;
    const savedProcess = win.process;
    win.require = undefined;
    win.process = undefined;
    try {
      const h = build({ [LEASE_PATH]: sidecarJson(LIVE_HOLDER, "lease") });
      await h.view.flushSave("autosave");
      expect(h.read).not.toHaveBeenCalled();
      expect(h.remove).not.toHaveBeenCalled();
      expect(h.writeNote).toHaveBeenCalledTimes(1);
      expect(h.view.dirty).toBe(false);
    } finally {
      win.require = savedRequire;
      win.process = savedProcess;
    }
  });

  it("mobile (no node host): keep-local writes without touching sidecars", async () => {
    const win = window as unknown as { require?: unknown; process?: unknown };
    const savedRequire = win.require;
    const savedProcess = win.process;
    win.require = undefined;
    win.process = undefined;
    try {
      const h = build({ [LEASE_PATH]: sidecarJson(LIVE_HOLDER, "lease") });
      await h.view.overwriteFileFromEditor();
      // Desktop keep-local would hit the conflict dialog; on mobile there
      // is no gate at all — the write goes through, sidecars untouched.
      expect(h.writeNote).toHaveBeenCalledTimes(1);
      expect(h.read).not.toHaveBeenCalled();
      expect(h.remove).not.toHaveBeenCalled();
      expect(h.openModal).not.toHaveBeenCalled();
      expect(h.view.dirty).toBe(false);
    } finally {
      win.require = savedRequire;
      win.process = savedProcess;
    }
  });

  it("rescues dirty content to a temp copy on a teardown flush blocked by a live lease", async () => {
    const h = build({ [LEASE_PATH]: sidecarJson(LIVE_HOLDER, "lease") });
    await h.view.flushSave("close");
    // Recovery rescue: the dirty JSON parks in a .tmp copy; writeNote (the
    // real overwrite) never ran, no dialog, no retry on a dying view.
    expect(h.write).toHaveBeenCalledTimes(1);
    expect(h.write.mock.calls[0][0]).toMatch(/^local\/\.y\.note\..*\.tmp$/);
    expect(h.writeNote).not.toHaveBeenCalled();
    expect(h.openModal).not.toHaveBeenCalled();
    expect(h.scheduleSave).not.toHaveBeenCalled();
  }, 10_000);

  it("keep-local never writes over a live foreign lease — the conflict dialog returns", async () => {
    const h = build({ [LEASE_PATH]: sidecarJson(LIVE_HOLDER, "lease") });
    await h.view.overwriteFileFromEditor();
    expect(h.writeNote).not.toHaveBeenCalled();
    expect(h.openModal).toHaveBeenCalledTimes(1);
    expect(h.view.dirty).toBe(true);
  });

  it("keep-local proceeds and releases the lease when the gate is clear", async () => {
    const h = build();
    await h.view.overwriteFileFromEditor();
    expect(h.writeNote).toHaveBeenCalledTimes(1);
    expect(h.view.dirty).toBe(false);
  });

  it("writes when both sidecars are absent", async () => {
    const h = build();
    await h.view.flushSave("autosave");
    expect(h.writeNote).toHaveBeenCalledTimes(1);
    expect(h.remove).not.toHaveBeenCalled();
  });
});
