import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import {
  decideLockGate,
  detectNodeLockHost,
  EditorLease,
  isInsumSidecarPath,
  parseSidecarText,
  readSidecar,
  resolveUmLockGate,
  sidecarAgeMs,
  sidecarNameFits,
  sidecarPaths,
  sidecarVerdict,
  type LockHost,
  type SidecarRead,
  type UmSidecar,
} from "./umLock";

/** A supported sidecar body with overridable fields. */
const FILE = "local/x.um";
const LEASE_PATH = "local/.x.um.insum-lease";

function sidecar(overrides: Partial<UmSidecar> = {}): UmSidecar {
  return {
    format: 1,
    kind: "lease",
    holder: { kind: "plugin", pid: 4242, hostname: "mac.local" },
    op_id: "abcdef014242",
    created_at: 1_000,
    purpose: "editor-dirty",
    ...overrides,
  };
}

const SAME_HOST: LockHost = {
  hostname: () => "mac.local",
  pid: () => 4242,
  pidAlive: () => true,
};

function hostOf(overrides: Partial<LockHost>): LockHost {
  return { ...SAME_HOST, ...overrides };
}

describe("parseSidecarText", () => {
  it("parses a supported sidecar and normalizes optional fields", () => {
    const read = parseSidecarText(JSON.stringify(sidecar({ purpose: undefined })));
    expect(read.state).toBe("supported");
    if (read.state !== "supported") return;
    expect(read.sidecar).toEqual(
      sidecar({ holder: { kind: "plugin", pid: 4242, hostname: "mac.local" }, purpose: null }),
    );
  });

  it("treats garbage and missing fields as corrupt", () => {
    expect(parseSidecarText("not json {").state).toBe("corrupt");
    expect(parseSidecarText(JSON.stringify({ format: 1, kind: "lease" })).state).toBe("corrupt");
    expect(parseSidecarText(JSON.stringify(sidecar({ holder: undefined }))).state).toBe("corrupt");
    expect(parseSidecarText(JSON.stringify(sidecar({ op_id: 5 as unknown as string }))).state).toBe("corrupt");
    expect(parseSidecarText("null").state).toBe("corrupt");
  });

  it("treats an unknown format or kind as foreign (never interpreted)", () => {
    expect(parseSidecarText(JSON.stringify(sidecar({ format: 2 }))).state).toBe("foreign");
    expect(parseSidecarText(JSON.stringify(sidecar({ kind: "mutex" }))).state).toBe("foreign");
  });
});

describe("sidecarPaths / isInsumSidecarPath", () => {
  it("builds dot sidecars next to the document", () => {
    expect(sidecarPaths("notes/x.um")).toEqual({
      lock: "notes/.x.um.insum-lock",
      lease: "notes/.x.um.insum-lease",
    });
    expect(sidecarPaths("x.note")).toEqual({
      lock: ".x.note.insum-lock",
      lease: ".x.note.insum-lease",
    });
  });

  it("recognizes its own sidecar files only", () => {
    expect(isInsumSidecarPath("notes/.x.um.insum-lock")).toBe(true);
    expect(isInsumSidecarPath(".x.note.insum-lease")).toBe(true);
    expect(isInsumSidecarPath("notes/.x.um.insum-lease.bak")).toBe(false);
    expect(isInsumSidecarPath("notes/x.um")).toBe(false);
    expect(isInsumSidecarPath("notes/insum-lock")).toBe(false);
    expect(isInsumSidecarPath(".inscriptum-log.jsonl")).toBe(false);
  });
});

describe("sidecarNameFits", () => {
  it("accepts normal names", () => {
    expect(sidecarNameFits("local/x.um")).toBe(true);
    expect(sidecarNameFits("x.note")).toBe(true);
  });

  it("rejects names whose sidecar component would exceed the filesystem cap", () => {
    expect(sidecarNameFits(`${"f".repeat(250)}.um`)).toBe(false);
    // Boundary: ".{name}.um.insum-lease" caps the name at 255 − 16 = 239.
    expect(sidecarNameFits(`${"f".repeat(239)}.um`)).toBe(true);
    expect(sidecarNameFits(`${"f".repeat(240)}.um`)).toBe(false);
  });
});

describe("sidecarAgeMs", () => {
  it("clamps the recorded creation from below by the mtime, saturating at zero", () => {
    // A skewed clock claims the future — the age saturates at 0 (fresh),
    // exactly like the CLI's saturating_sub.
    expect(sidecarAgeMs(1_500, 5_000, 1_200)).toBe(0);
    // A far-past recorded time is clamped up to the mtime.
    expect(sidecarAgeMs(1_500, 0, 1_200)).toBe(300);
    expect(sidecarAgeMs(1_500, 1_400, 1_200)).toBe(100);
  });

  it("is infinite without any anchor (unreadable file)", () => {
    expect(sidecarAgeMs(1_500, null, null)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("sidecarVerdict", () => {
  const NOW = 10 * 60 * 1_000; // 10 minutes past the epoch anchor 0
  const FRESH = { nowMs: NOW, mtimeMs: NOW - 1_000 };
  const OLD = { nowMs: NOW, mtimeMs: NOW - 5 * 60 * 1_000 }; // 5 min old

  it("own: this very process (plugin kind, same host and pid)", () => {
    const read: SidecarRead = { state: "supported", sidecar: sidecar() };
    expect(sidecarVerdict(read, { ...FRESH, host: SAME_HOST })).toBe("own");
    // A different pid on the same host is NOT ours even for the same kind.
    const other: SidecarRead = {
      state: "supported",
      sidecar: sidecar({ holder: { kind: "plugin", pid: 9999, hostname: "mac.local" } }),
    };
    expect(sidecarVerdict(other, { ...FRESH, host: SAME_HOST })).toBe("live");
  });

  it("same host: the pid probe is authoritative", () => {
    const otherPid = sidecar({ holder: { kind: "cli", pid: 7777, hostname: "mac.local" } });
    const read: SidecarRead = { state: "supported", sidecar: otherPid };
    expect(sidecarVerdict(read, { ...OLD, host: hostOf({ pidAlive: () => true }) })).toBe("live");
    expect(sidecarVerdict(read, { ...FRESH, host: hostOf({ pidAlive: () => false }) })).toBe(
      "stale",
    );
  });

  it("cross-host and unknown host: age decides", () => {
    const foreign: SidecarRead = {
      state: "supported",
      sidecar: sidecar({ holder: { kind: "cli", pid: 7, hostname: "other.host" } }),
    };
    expect(sidecarVerdict(foreign, { ...FRESH, host: SAME_HOST })).toBe("conservative");
    expect(sidecarVerdict(foreign, { ...OLD, host: SAME_HOST })).toBe("stale");
    const noHost: SidecarRead = {
      state: "supported",
      sidecar: sidecar({ holder: { kind: "cli", pid: 7, hostname: null } }),
    };
    expect(sidecarVerdict(noHost, { ...FRESH, host: hostOf({ hostname: () => null }) })).toBe(
      "conservative",
    );
    expect(sidecarVerdict(noHost, { ...OLD, host: hostOf({ hostname: () => null }) })).toBe("stale");
    // Unknown host on our side (mobile) — same decay by age.
    expect(sidecarVerdict(foreign, { ...OLD, host: hostOf({ hostname: () => null }) })).toBe("stale");
  });

  it("same-host probe unavailable: conservative while fresh, stale when old", () => {
    const otherPid = sidecar({ holder: { kind: "cli", pid: 7777, hostname: "mac.local" } });
    const read: SidecarRead = { state: "supported", sidecar: otherPid };
    expect(sidecarVerdict(read, { ...FRESH, host: hostOf({ pidAlive: () => null }) })).toBe(
      "conservative",
    );
    expect(sidecarVerdict(read, { ...OLD, host: hostOf({ pidAlive: () => null }) })).toBe("stale");
  });

  it("corrupt and foreign files: conservative while fresh, stale when old; absent is stale", () => {
    expect(sidecarVerdict({ state: "corrupt" }, { ...FRESH, host: SAME_HOST })).toBe(
      "conservative",
    );
    expect(sidecarVerdict({ state: "corrupt" }, { ...OLD, host: SAME_HOST })).toBe("stale");
    expect(sidecarVerdict({ state: "foreign" }, { ...FRESH, host: SAME_HOST })).toBe(
      "conservative",
    );
    expect(sidecarVerdict({ state: "foreign" }, { ...OLD, host: SAME_HOST })).toBe("stale");
    expect(sidecarVerdict({ state: "absent" }, { ...FRESH, host: SAME_HOST })).toBe("stale");
  });

  it("unreadable sidecar is conservative regardless of age (fail-closed)", () => {
    expect(sidecarVerdict({ state: "unreadable" }, { ...FRESH, host: SAME_HOST })).toBe(
      "conservative",
    );
    expect(sidecarVerdict({ state: "unreadable" }, { ...OLD, host: SAME_HOST })).toBe(
      "conservative",
    );
    // No mtime anchor: still conservative — an unreadable holder is never
    // declared gone (the CLI aborts the write on IO errors instead).
    expect(
      sidecarVerdict({ state: "unreadable" }, { nowMs: NOW, mtimeMs: null, host: SAME_HOST }),
    ).toBe("conservative");
  });

  it("own via ownOpId even where the host cannot be probed (mobile, NULL host)", () => {
    const noHost = { hostname: () => null, pid: () => null, pidAlive: () => null };
    const read: SidecarRead = { state: "supported", sidecar: sidecar() };
    expect(
      sidecarVerdict(read, { ...FRESH, host: noHost, ownOpId: "abcdef014242" }),
    ).toBe("own");
    // A different op_id on the same file stays conservative (unprobeable).
    expect(
      sidecarVerdict(read, { ...FRESH, host: noHost, ownOpId: "other00000000" }),
    ).toBe("conservative");
    // No op_id known yet (acquire in flight): conservative, retried later.
    expect(sidecarVerdict(read, { ...FRESH, host: noHost, ownOpId: null })).toBe(
      "conservative",
    );
  });

  it("oversized sidecars never reach the verdict path, but a corrupt verdict follows the same policy", () => {
    // The size guard lives in readSidecar; here we pin that "corrupt" from
    // any source (parse or size) behaves identically.
    expect(sidecarVerdict({ state: "corrupt" }, { ...FRESH, host: SAME_HOST })).toBe(
      "conservative",
    );
  });
});

describe("decideLockGate", () => {
  const state = (
    verdict: "own" | "live" | "stale" | "conservative",
  ): { read: SidecarRead; verdict: "own" | "live" | "stale" | "conservative" } => ({
    read: { state: "absent" },
    verdict,
  });

  it("live foreign lease is a conflict", () => {
    expect(decideLockGate(state("live"), state("stale")).action).toBe("conflict");
  });

  it("a conservative lease defers (fresh corrupt may be mid-write)", () => {
    const d = decideLockGate(state("conservative"), state("stale"));
    expect(d).toEqual({ action: "defer", reason: "conservative" });
  });

  it("live and conservative locks defer (foreign commit in flight)", () => {
    expect(decideLockGate(state("own"), state("live"))).toEqual({
      action: "defer",
      reason: "foreign-lock",
    });
    expect(decideLockGate(state("own"), state("conservative"))).toEqual({
      action: "defer",
      reason: "conservative",
    });
  });

  it("own or stale sidecars proceed", () => {
    expect(decideLockGate(state("own"), state("own")).action).toBe("proceed");
    expect(decideLockGate(state("stale"), state("stale")).action).toBe("proceed");
  });
});

/** An in-memory adapter standing in for DataAdapter in lease IO tests. */
function fakeAdapter(initial: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(initial));
  const reads = { count: 0 };
  const adapter = {
    stat: vi.fn(async (path: string) => {
      if (!files.has(path)) return null;
      return { mtime: 1_000, size: (files.get(path) as string).length };
    }),
    read: vi.fn(async (path: string) => {
      reads.count += 1;
      if (!files.has(path)) throw new Error("missing");
      return files.get(path) as string;
    }),
    write: vi.fn(async (path: string, data: string) => {
      files.set(path, data);
    }),
    remove: vi.fn(async (path: string) => {
      files.delete(path);
    }),
  };
  return { adapter, files, reads };
}

function leaseVault(adapter: unknown) {
  return {
    adapter,
    getAbstractFileByPath: (path: string) => (path === "local/x.um" ? { path } : null),
  } as never;
}

describe("EditorLease", () => {
  const deps = (adapter: unknown, opts: { dirty: () => boolean; host?: LockHost | null }) => ({
    vault: leaseVault(adapter),
    filePath: () => FILE,
    hasUnsavedChanges: opts.dirty,
    host: opts.host ?? SAME_HOST,
  });

  it("creates a lease when dirty and releases it afterwards", async () => {
    const { adapter, files } = fakeAdapter();
    let dirty = true;
    const lease = new EditorLease(deps(adapter, { dirty: () => dirty }));
    await lease.sync();
    expect(files.has(LEASE_PATH)).toBe(true);
    const body = JSON.parse(files.get(LEASE_PATH) as string);
    expect(body).toMatchObject({
      format: 1,
      kind: "lease",
      holder: { kind: "plugin", pid: 4242, hostname: "mac.local" },
      purpose: "editor-dirty",
    });
    expect(typeof body.op_id).toBe("string");
    expect(typeof body.created_at).toBe("number");

    dirty = false;
    await lease.release();
    expect(files.has(LEASE_PATH)).toBe(false);
  });

  it("releases only its own op_id — a foreign holder's file stays", async () => {
    const foreign = sidecar({
      holder: { kind: "plugin", pid: 7, hostname: "other.host" },
      op_id: "deadbeefcafe",
    });
    const { adapter, files } = fakeAdapter({ [LEASE_PATH]: JSON.stringify(foreign) });
    const lease = new EditorLease(deps(adapter, { dirty: () => false }));
    // Never acquired here — release without our own lease must not touch
    // the foreign file.
    await lease.release();
    expect(files.has(LEASE_PATH)).toBe(true);
  });

  it("does not acquire over a live foreign or same-process lease", async () => {
    const foreign = sidecar({
      holder: { kind: "plugin", pid: 7, hostname: "other.host" },
      created_at: Date.now() - 1_000, // fresh: cross-host, still conservative-live
    });
    const { adapter, files } = fakeAdapter({ [LEASE_PATH]: JSON.stringify(foreign) });
    const lease = new EditorLease(deps(adapter, { dirty: () => true }));
    await lease.sync();
    expect(files.get(LEASE_PATH)).toBe(JSON.stringify(foreign)); // untouched
    expect(lease.currentOpId()).toBe(null);

    // Same pid + host: that is another PANE of this very process editing
    // the same file — adopting (and later releasing) its lease would strip
    // the sibling pane's protection (PR #26 review). Never adopted.
    const sibling = sidecar({ holder: { kind: "plugin", pid: 4242, hostname: "mac.local" } });
    const { adapter: adapter2, files: files2 } = fakeAdapter({
      [LEASE_PATH]: JSON.stringify(sibling),
    });
    const lease2 = new EditorLease(deps(adapter2, { dirty: () => true }));
    await lease2.sync();
    expect(files2.get(LEASE_PATH)).toBe(JSON.stringify(sibling)); // untouched
    expect(lease2.currentOpId()).toBe(null);
  });

  it("a failed removal keeps the op_id — the next release retries", async () => {
    const { adapter, files } = fakeAdapter();
    let failRemove = true;
    const failing = {
      ...adapter,
      remove: async (path: string) => {
        if (failRemove) throw new Error("EBUSY");
        files.delete(path);
      },
    };
    const lease = new EditorLease(deps(failing, { dirty: () => true }));
    await lease.sync();
    expect(files.has(LEASE_PATH)).toBe(true);
    await lease.release();
    // Removal failed: the sidecar stays and its owner is NOT forgotten —
    // a forgotten op_id would orphan the file with nobody able to release.
    expect(files.has(LEASE_PATH)).toBe(true);
    expect(lease.currentOpId()).not.toBe(null);
    failRemove = false;
    await lease.release(); // retried on the next save/close
    expect(files.has(LEASE_PATH)).toBe(false);
    expect(lease.currentOpId()).toBe(null);
  });

  it("sync moves the lease when the file is renamed while dirty", async () => {
    const { adapter, files } = fakeAdapter();
    const live = { path: FILE };
    const lease = new EditorLease({
      vault: leaseVault(adapter),
      filePath: () => live.path,
      hasUnsavedChanges: () => true,
      host: SAME_HOST,
    });
    await lease.sync();
    expect(files.has(LEASE_PATH)).toBe(true);
    const oldOpId = lease.currentOpId();
    live.path = "local/renamed.um"; // user rename while the doc is dirty
    await lease.sync();
    expect(files.has(LEASE_PATH)).toBe(false); // old sidecar released
    expect(files.has("local/.renamed.um.insum-lease")).toBe(true); // moved
    expect(lease.currentOpId()).not.toBe(null);
    expect(lease.currentOpId()).not.toBe(oldOpId); // fresh acquire
    await lease.release();
    expect(files.has("local/.renamed.um.insum-lease")).toBe(false);
  });

  it("cleans up when the save lands while the acquire is in flight", async () => {
    const { adapter, files } = fakeAdapter();
    let dirty = true;
    const lease = new EditorLease(deps(adapter, { dirty: () => dirty }));
    const pending = lease.sync();
    dirty = false; // the save completes before the acquire finishes
    await pending;
    expect(files.has(LEASE_PATH)).toBe(false);
  });

  it("pins release to the leased path even if the file was renamed mid-flight", async () => {
    const { adapter, files } = fakeAdapter();
    const filePathRef = { path: FILE };
    const lease = new EditorLease({
      vault: {
        adapter,
        getAbstractFileByPath: (p: string) => (p === filePathRef.path ? { path: p } : null),
      } as never,
      filePath: () => filePathRef.path,
      hasUnsavedChanges: () => true,
      host: SAME_HOST,
    });
    await lease.sync();
    filePathRef.path = "local/renamed.um"; // the view switched files
    await lease.release();
    expect(files.has(LEASE_PATH)).toBe(false); // the ORIGINAL sidecar removed
    expect(files.has("local/.renamed.um.insum-lease")).toBe(false);
  });
});

describe("readSidecar", () => {
  it("absent for a missing file (stat null); unreadable for IO errors (fail-closed)", async () => {
    const { adapter } = fakeAdapter();
    await expect(readSidecar(adapter as never, "nope")).resolves.toEqual({ state: "absent" });
    const throwingStat = { stat: async () => { throw new Error("boom"); }, read: async () => "x" };
    await expect(readSidecar(throwingStat as never, "nope")).resolves.toEqual({
      state: "unreadable",
    });
    const throwingRead = {
      stat: async () => ({ mtime: 1, size: 10 }),
      read: async () => {
        throw new Error("eacces");
      },
    };
    await expect(readSidecar(throwingRead as never, "x")).resolves.toEqual({
      state: "unreadable",
    });
  });

  it("corrupt for an oversized file without loading it into memory", async () => {
    const { adapter, reads } = fakeAdapter({ big: "x".repeat(70 * 1024) });
    const read = await readSidecar(adapter as never, "big");
    expect(read.state).toBe("corrupt");
    expect(reads.count).toBe(0); // never loaded
  });

  it("round-trips a supported body; a vanished file reads as absent", async () => {
    const { adapter } = fakeAdapter({ [LEASE_PATH]: JSON.stringify(sidecar()) });
    const read = await readSidecar(adapter as never, LEASE_PATH);
    expect(read.state).toBe("supported");
    const vanishing = {
      stat: async () => ({ mtime: 1, size: 10 }),
      read: async () => {
        throw new Error("gone");
      },
    };
    await expect(readSidecar(vanishing as never, "x")).resolves.toEqual({ state: "unreadable" });
  });
});

describe("detectNodeLockHost (real node host, pid guard)", () => {
  const req = createRequire(import.meta.url);
  it("treats pid 0 and negatives as dead, its own pid as alive", () => {
    (window as unknown as { require?: (id: string) => unknown }).require = (id: string) => req(id);
    (window as unknown as { process?: unknown }).process = process;
    const host = detectNodeLockHost();
    if (host == null) throw new Error("node host expected under the jsdom+node test env");
    expect(host.hostname()).not.toBe(null);
    expect(host.pidAlive(0)).toBe(false);
    expect(host.pidAlive(-1)).toBe(false);
    expect(host.pidAlive(999_999_999)).toBe(false);
    expect(host.pidAlive(process.pid)).toBe(true);
  });
});

describe("EditorLease without a node host (mobile scope)", () => {
  it("sync is a no-op: no lease file is ever created or read", async () => {
    const { adapter, files, reads } = fakeAdapter();
    const lease = new EditorLease({
      vault: leaseVault(adapter),
      filePath: () => FILE,
      hasUnsavedChanges: () => true,
      host: null,
    });
    await lease.sync();
    await lease.release();
    expect(files.size).toBe(0);
    expect(reads.count).toBe(0);
    expect(lease.currentOpId()).toBe(null);
  });
});

describe("resolveUmLockGate: fresh corrupt sidecars are not deleted (PR #26 review)", () => {
  const DOC = "local/z.um";
  const LOCK = "local/.z.um.insum-lock";
  const LEASE = "local/.z.um.insum-lease";

  function corruptVault(sidecarMtimes: Record<string, number>) {
    const removed: string[] = [];
    const adapter = {
      stat: async (p: string) =>
        sidecarMtimes[p] != null
          ? { mtime: sidecarMtimes[p], size: 7 }
          : p === DOC
            ? { mtime: 1, size: 1 }
            : null,
      read: async () => "corrupted and not json {{{",
      remove: async (p: string) => {
        removed.push(p);
      },
    };
    return { vault: { adapter } as never, removed };
  }

  it("fresh corrupt blocks conservatively and survives the cleanup", async () => {
    const { vault, removed } = corruptVault({
      [LEASE]: Date.now() - 500,
      [LOCK]: Date.now() - 500,
    });
    const decision = await resolveUmLockGate(vault, DOC, SAME_HOST);
    expect(decision.action).toBe("defer");
    expect(removed).toEqual([]); // an active writer's mid-write file stands
  });

  it("aged corrupt is broken and the write proceeds", async () => {
    const { vault, removed } = corruptVault({
      [LEASE]: Date.now() - 120_000,
      [LOCK]: Date.now() - 120_000,
    });
    const decision = await resolveUmLockGate(vault, DOC, SAME_HOST);
    expect(decision.action).toBe("proceed");
    expect(removed.sort()).toEqual([LOCK, LEASE].sort());
  });
});
