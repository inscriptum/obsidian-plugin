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

const req = createRequire(import.meta.url);
(window as unknown as { require?: (id: string) => unknown }).require = (id: string) => {
  if (id === "fs") return { renameSync: () => {} };
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
  const stat = vi.fn(async (path: string) => {
    if (path in sidecars) return { mtime: Date.now() - 500, size: sidecars[path].length };
    if (path === FILE) return { mtime: 100, size: 10 };
    return null;
  });
  const read = vi.fn(async (path: string) => {
    if (path in sidecars) return sidecars[path];
    throw new Error("missing");
  });
  const remove = vi.fn(async () => {});
  const write = vi.fn(async (_path: string, _data: string) => {});
  const openModal = vi.fn();
  const scheduleSave = vi.fn();
  const view = Object.create(NoteView.prototype) as Record<string, unknown> & {
    flushSave: (trigger?: string) => Promise<void>;
    overwriteFileFromEditor: () => Promise<void>;
  };
  Object.assign(view, {
    editor: { getJSON: () => ({ type: "doc" }), isDestroyed: false },
    file: { path: FILE, name: "y.note", stat: { size: 10 } },
    app: {
      vault: {
        adapter: { stat, read, remove, write },
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
  return { view, stat, read, remove, write, openModal, scheduleSave, writeNote: writeNote as ReturnType<typeof vi.fn> };
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
