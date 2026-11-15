/**
 * The plugin half of the CLI ↔ plugin lock protocol (spec §9.2,
 * issues/um-lock-lease; protocol document — DEVELOPMENT/insum/lock-protocol.um,
 * CLI half — insum crates/insum-core/src/lock.rs, merged in PR #151).
 *
 * Two hidden sidecar files next to a document protect it from concurrent
 * writers and from overwriting unsaved editor state:
 *
 * - `.<name>.insum-lock` — the CLI's short-lived commit lock. The plugin
 *   never creates one; its autosave respects a live foreign lock by
 *   deferring the write (retry on the regular autosave schedule).
 * - `.<name>.insum-lease` — this editor's dirty lease. Created when an
 *   open document first holds unsaved changes, released on a successful
 *   save and on close; a live foreign lease is a conflict — the write is
 *   routed into the existing FileChangedModal path.
 *
 * Recovery rules mirror the CLI exactly: a same-host holder is probed by
 * pid (live holders are never broken, dead ones immediately); a
 * cross-host or unknown-host holder cannot be probed and only ages out
 * past `stale_after`; corrupt or unknown-format files block
 * conservatively while fresh (they may be mid-write) and are broken once
 * stale. The recorded creation time is clamped from below by the file
 * mtime, so a skewed clock cannot make a fresh sidecar look ancient.
 *
 * Sidecars are dot-prefixed (never indexed as notes, no vault events) and
 * are removed with adapter.remove — safe under rule-open-file-safety:
 * they are hidden service files no view can hold open.
 */

import type { DataAdapter, Vault } from "obsidian";

export const LOCK_SUFFIX = ".insum-lock";
export const LEASE_SUFFIX = ".insum-lease";

/** Format version of the sidecar JSON; a different value is foreign and
 *  is never interpreted, only aged (protocol recovery rule). */
const SIDECAR_FORMAT = 1;

/** A sidecar larger than this is not a legitimate lock/lease — corrupt by
 *  definition, not loaded into memory (same cap as the CLI). */
export const SIDECAR_MAX_BYTES = 64 * 1024;

/** Age after which a holder that cannot be probed (cross-host, unknown
 *  host) and corrupt files are declared gone. A live same-host holder is
 *  never broken, whatever its age. */
export const STALE_AFTER_MS = 60_000;

export interface UmLockHolder {
  kind: string;
  pid: number;
  /** null/absent = unknown host: pid probing is not trustworthy. */
  hostname: string | null;
}

export interface UmSidecar {
  format: number;
  kind: string;
  holder: UmLockHolder;
  op_id: string;
  created_at: number;
  purpose: string | null;
}

export type SidecarRead =
  | { state: "absent" }
  | { state: "supported"; sidecar: UmSidecar }
  | { state: "foreign" }
  | { state: "corrupt" }
  /** The sidecar exists but cannot be stat'ed/read (transient FS error).
   *  Fail-closed like the CLI (Err aborts the write): block this attempt,
   *  the next autosave retries — never treat an unreadable holder as gone. */
  | { state: "unreadable" };

/** Platform facts the verdicts need; nulls on platforms without node
 *  (mobile): hostname unknown, own pid unknown, liveness unprobeable —
 *  everything then decays by age, exactly like a cross-host holder. */
export interface LockHost {
  hostname(): string | null;
  pid(): number | null;
  pidAlive(pid: number): boolean | null;
}

/** The node-based host used on desktop; null when node fs is unavailable
 *  (mobile / sandboxed harness). */
export function detectNodeLockHost(): LockHost | null {
  try {
    const req = (window as { require?: (id: string) => unknown }).require;
    if (typeof req !== "function") return null;
    const os = req("os") as { hostname?: () => string };
    // With node integration on, the renderer exposes `process` on the
    // window object (the popout-safe accessor, per the lint rule).
    const win = window as unknown as {
      process?: { pid: number; kill: (pid: number, sig: number) => boolean };
    };
    if (win.process?.pid == null) return null;
    const pid = win.process.pid;
    const kill = win.process.kill.bind(win.process);
    const hostname = (): string | null => {
      try {
        const name = os.hostname?.();
        return name ? name : null;
      } catch {
        return null;
      }
    };
    const pidAlive = (target: number): boolean => {
      // kill(pid, 0) throws ESRCH when nobody is there; a permission error
      // (EPERM) still proves existence. pid 0 / negative never name a
      // probeable process.
      if (target <= 0) return false;
      try {
        kill(target, 0);
        return true;
      } catch (err) {
        const code = (err as { code?: string }).code;
        return code === "EPERM";
      }
    };
    return { hostname, pid: () => pid, pidAlive };
  } catch {
    return null;
  }
}

/** The two sidecar paths for a document path: a leading dot, the
 *  document's own name, the protocol suffix — same directory. */
export function sidecarPaths(filePath: string): { lock: string; lease: string } {
  const slash = filePath.lastIndexOf("/");
  const dir = slash === -1 ? "" : filePath.slice(0, slash + 1);
  const name = slash === -1 ? filePath : filePath.slice(slash + 1);
  return {
    lock: `${dir}.${name}${LOCK_SUFFIX}`,
    lease: `${dir}.${name}${LEASE_SUFFIX}`,
  };
}

/** The file-name component cap of mainstream local filesystems (ext4 and
 *  APFS count bytes, NTFS counts UTF-16 units — all cap at 255). */
const COMPONENT_CAP = 255;

/** CLI parity (lock.rs check_sidecar_name_fits, R3COR-1): the sidecar is
 *  named after the target — a name that leaves no room for it can never
 *  hold a lease, so do not try (and do not misreport it as foreign). */
export function sidecarNameFits(filePath: string): boolean {
  const name = filePath.slice(filePath.lastIndexOf("/") + 1);
  return [LOCK_SUFFIX, LEASE_SUFFIX].every(
    (suffix) => `.${name}${suffix}`.length <= COMPONENT_CAP,
  );
}

/** True for the protocol's own sidecar files (both editors' external-change
 *  watchers must never treat them as foreign writes of the document). */
export function isInsumSidecarPath(path: string): boolean {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return name.startsWith(".") && (name.endsWith(LOCK_SUFFIX) || name.endsWith(LEASE_SUFFIX));
}

/** Parse sidecar JSON text. Corrupt/foreign classification mirrors the CLI:
 *  anything that parses but carries an unknown format or kind is foreign
 *  (only ever aged, never interpreted); unparsable text is corrupt. */
export function parseSidecarText(text: string): SidecarRead {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { state: "corrupt" };
  }
  const sidecar = raw as UmSidecar | null;
  if (
    sidecar == null ||
    typeof sidecar !== "object" ||
    typeof sidecar.op_id !== "string" ||
    typeof sidecar.created_at !== "number" ||
    sidecar.holder == null ||
    typeof sidecar.holder.kind !== "string" ||
    typeof sidecar.holder.pid !== "number" ||
    (sidecar.holder.hostname != null && typeof sidecar.holder.hostname !== "string") ||
    (sidecar.purpose != null && typeof sidecar.purpose !== "string")
  ) {
    return { state: "corrupt" };
  }
  if (sidecar.format !== SIDECAR_FORMAT || (sidecar.kind !== "lock" && sidecar.kind !== "lease")) {
    return { state: "foreign" };
  }
  return {
    state: "supported",
    sidecar: {
      format: sidecar.format,
      kind: sidecar.kind,
      holder: { kind: sidecar.holder.kind, pid: sidecar.holder.pid, hostname: sidecar.holder.hostname ?? null },
      op_id: sidecar.op_id,
      created_at: sidecar.created_at,
      purpose: sidecar.purpose ?? null,
    },
  };
}

/** Read one sidecar through the adapter. The size guard stats first: an
 *  oversized file is corrupt by definition and is never loaded. */
export async function readSidecar(adapter: DataAdapter, path: string): Promise<SidecarRead> {
  let size: number | null = null;
  try {
    const stat = await adapter.stat(path);
    if (stat == null) return { state: "absent" };
    size = stat.size;
  } catch {
    // Missing files return null above; a throw is a real IO error —
    // fail closed (the CLI returns Err and aborts the write).
    return { state: "unreadable" };
  }
  if (size > SIDECAR_MAX_BYTES) return { state: "corrupt" };
  let text: string;
  try {
    text = await adapter.read(path);
  } catch {
    // Gone between stat and read, or an IO error: block this attempt
    // either way — the next autosave re-checks.
    return { state: "unreadable" };
  }
  return parseSidecarText(text);
}

/** Age of a sidecar in ms: now − max(recorded creation, mtime), saturated
 *  at zero (the CLI's saturating_sub — a future claim just means fresh).
 *  The mtime clamp is the protocol's clock-skew guard; no anchor at all
 *  (unreadable file) is infinitely old → stale. */
export function sidecarAgeMs(nowMs: number, recordedCreatedAt: number | null, mtimeMs: number | null): number {
  const anchors = [recordedCreatedAt, mtimeMs].filter((v): v is number => v != null);
  if (anchors.length === 0) return Number.POSITIVE_INFINITY;
  return Math.max(0, nowMs - Math.max(...anchors));
}

/** Recovery verdict for one sidecar (the CLI's holder_is_gone + corrupt
 *  policy, mirrored decision-for-decision):
 *  - own — recorded holder is this very process (kind plugin, same host,
 *    same pid): the file is ours to reuse/release;
 *  - live — a live foreign holder: never broken, whatever the age;
 *  - stale — provably gone (dead pid on this host) or aged out: safe to
 *    remove;
 *  - conservative — fresh but unprobeable (cross-host/unknown/corrupt/
 *    foreign format): blocks for now, breaks after stale_after. */
export type SidecarVerdict = "own" | "live" | "stale" | "conservative";

export function sidecarVerdict(
  read: SidecarRead,
  opts: {
    nowMs: number;
    mtimeMs: number | null;
    staleAfterMs?: number;
    host: LockHost;
    /** op_id of THIS editor's live lease (when known): a sidecar recording
     *  it is our own file even where the pid/host cannot be probed — the
     *  op_id is unguessable and only its owner knows it. */
    ownOpId?: string | null;
  },
): SidecarVerdict {
  const staleAfter = opts.staleAfterMs ?? STALE_AFTER_MS;
  if (read.state === "absent") return "stale";
  if (read.state === "unreadable") return "conservative";
  if (read.state === "corrupt" || read.state === "foreign") {
    return sidecarAgeMs(opts.nowMs, null, opts.mtimeMs) > staleAfter ? "stale" : "conservative";
  }
  if (opts.ownOpId != null && read.sidecar.op_id === opts.ownOpId) return "own";
  const s = read.sidecar;
  const mine = opts.host.pid();
  const myHost = opts.host.hostname();
  const holderHost = s.holder.hostname;
  if (s.holder.kind === "plugin" && mine != null && myHost != null && holderHost === myHost && s.holder.pid === mine) {
    return "own";
  }
  const sameHost = holderHost != null && myHost != null && holderHost === myHost;
  if (sameHost) {
    const alive = opts.host.pidAlive(s.holder.pid);
    if (alive === true) return "live";
    if (alive === false) return "stale";
    // Probe unavailable despite a known host (shouldn't happen with the
    // node host, but a null-safe default keeps the conservative direction).
    return sidecarAgeMs(opts.nowMs, s.created_at, opts.mtimeMs) > staleAfter ? "stale" : "conservative";
  }
  return sidecarAgeMs(opts.nowMs, s.created_at, opts.mtimeMs) > staleAfter ? "stale" : "conservative";
}

/** What a flush must do before writing the document. Pure decision over
 *  both sidecar reads (the orchestration around it removes stale files). */
export type LockGateDecision =
  | { action: "proceed" }
  | { action: "defer"; reason: "foreign-lock" | "conservative" }
  | { action: "conflict" };

export function decideLockGate(
  lease: { read: SidecarRead; verdict: SidecarVerdict },
  lock: { read: SidecarRead; verdict: SidecarVerdict },
): LockGateDecision {
  // The lease decides first: a live foreign lease means another editor
  // holds unsaved changes — writing now would silently drop them (§9.1).
  if (lease.verdict === "live") return { action: "conflict" };
  if (lease.verdict === "conservative") return { action: "defer", reason: "conservative" };
  // own/stale lease: ours or provably gone — not an obstacle.
  if (lock.verdict === "live") return { action: "defer", reason: "foreign-lock" };
  if (lock.verdict === "conservative") return { action: "defer", reason: "conservative" };
  return { action: "proceed" };
}

/** Read both sidecars for a document, remove the stale ones (breaking a
 *  provably-gone holder is the protocol's recovery), and return the gate
 *  decision for a pending write. */
export async function resolveUmLockGate(
  vault: Vault,
  filePath: string,
  host: LockHost | null,
  ownLeaseOpId?: string | null,
): Promise<LockGateDecision> {
  const effectiveHost = host ?? NULL_LOCK_HOST;
  const { lock, lease } = sidecarPaths(filePath);
  const now = Date.now();
  const leasePath = lease;
  const lockPath = lock;
  const read = async (path: string) => {
    const r = await readSidecar(vault.adapter, path);
    let mtime: number | null = null;
    // corrupt too: creation is a two-step (create, then write the body), so
    // a fresh sidecar can briefly expose empty/partial JSON — without the
    // mtime its age is infinite and the cleanup below would delete an
    // active writer's protection mid-commit (PR #26 review).
    if (r.state !== "absent" && r.state !== "unreadable") {
      try {
        mtime = (await vault.adapter.stat(path))?.mtime ?? null;
      } catch {
        mtime = null;
      }
    }
    return {
      read: r,
      verdict: sidecarVerdict(r, { nowMs: now, mtimeMs: mtime, host: effectiveHost, ownOpId: ownLeaseOpId }),
    };
  };
  const leaseState = await read(leasePath);
  const lockState = await read(lockPath);
  // Break the stale sidecars: the holder is provably gone or aged out, so
  // removal cannot disturb a live writer (dot files, no view can hold them).
  for (const [state, path] of [
    [leaseState, leasePath],
    [lockState, lockPath],
  ] as const) {
    if (state.verdict === "stale" && state.read.state !== "absent") {
      try {
        await vault.adapter.remove(path);
      } catch {
        // Removal is best-effort: a failed break still lets the gate
        // decide below (a stale lease no longer blocks the verdict).
      }
    }
  }
  return decideLockGate(leaseState, lockState);
}

function newOpId(): string {
  // Same shape as the CLI's op_id: nanos+pid hex; uniqueness within a host
  // is all the release match needs.
  const nanos = (Date.now() % 0xffffffff) ^ Math.floor(Math.random() * 0xffff);
  const pid = detectNodeLockHost()?.pid() ?? 0;
  return `${(nanos >>> 0).toString(16).padStart(8, "0")}${(pid & 0xffff).toString(16).padStart(4, "0")}`;
}

export interface AcquireLeaseResult {
  ok: boolean;
  /** Set when the lease was created or reused from our own stale file. */
  opId?: string;
  /** A foreign lease already exists — ours was not created (their editor
   *  is dirty; our save path will surface the conflict). */
  foreign?: boolean;
  /** The document name leaves no room for the sidecar component (CLI's
   *  check_sidecar_name_fits): the lease cannot exist for this file. */
  nameTooLong?: boolean;
}

/** Create the dirty lease for a document (plugin-only per the protocol).
 *  Atomic via node's create-new on desktop; the adapter fallback (mobile)
 *  checks existence first — there is no CLI on mobile to race with. An
 *  existing foreign lease is never overwritten. */
export async function acquireUmLease(
  vault: Vault,
  filePath: string,
  host: LockHost | null,
): Promise<AcquireLeaseResult> {
  const effectiveHost = host ?? NULL_LOCK_HOST;
  const { lease } = sidecarPaths(filePath);
  if (!sidecarNameFits(filePath)) {
    return { ok: false, nameTooLong: true };
  }
  const existing = await readSidecar(vault.adapter, lease);
  if (existing.state === "unreadable") {
    return { ok: false, foreign: true };
  }
  if (existing.state !== "absent") {
    const verdict = sidecarVerdict(existing, {
      nowMs: Date.now(),
      mtimeMs: await statMtime(vault, lease),
      host: effectiveHost,
    });
    if (verdict === "stale") {
      try {
        await vault.adapter.remove(lease);
      } catch {
        // Fall through: the create below will fail on an unremovable
        // foreign file and report it.
      }
    } else {
      // "own" included: a same-pid holder can be ANOTHER pane of this very
      // process editing the same file — adopting (and later releasing) its
      // lease would strip the sibling pane's protection mid-edit (PR #26
      // review). A forgotten lease of this view cannot happen: release
      // keeps its op_id until the removal is confirmed, and sync moves the
      // lease across renames instead of re-acquiring blind.
      return { ok: false, foreign: true };
    }
  }
  const opId = newOpId();
  const body = JSON.stringify({
    format: SIDECAR_FORMAT,
    kind: "lease",
    holder: {
      kind: "plugin",
      pid: effectiveHost.pid() ?? 0,
      hostname: effectiveHost.hostname(),
    },
    op_id: opId,
    created_at: Date.now(),
    purpose: "editor-dirty",
  });
  // Desktop: exclusive create (O_EXCL) — exactly one winner, the protocol's
  // atomicity requirement. Mobile/no node: existence re-checked above.
  const node = nodeExclusiveWriter();
  if (node != null) {
    const full = adapterFullPath(vault, lease);
    if (full != null && node.createExclusive(full, body)) {
      node.chmod600(full);
      return { ok: true, opId };
    }
    // Lost the race or no full path — re-read: own (adopt) or foreign (give up).
    const reread = await readSidecar(vault.adapter, lease);
    if (reread.state === "supported") {
      const verdict = sidecarVerdict(reread, { nowMs: Date.now(), mtimeMs: await statMtime(vault, lease), host: effectiveHost });
      if (verdict === "own") return { ok: true, opId: reread.sidecar.op_id };
    }
    return { ok: false, foreign: true };
  }
  try {
    await vault.adapter.write(lease, body);
    return { ok: true, opId };
  } catch {
    return { ok: false, foreign: true };
  }
}

/** Remove the dirty lease, but only when it still records our op_id —
 *  a fallen owner must not delete a foreign holder's file (protocol's
 *  release rule). Returns true when a file was actually removed. */
export async function releaseUmLease(vault: Vault, filePath: string, opId: string): Promise<boolean> {
  const { lease } = sidecarPaths(filePath);
  const existing = await readSidecar(vault.adapter, lease);
  if (existing.state !== "supported") return false;
  if (existing.sidecar.op_id !== opId) return false;
  try {
    await vault.adapter.remove(lease);
    return true;
  } catch {
    return false;
  }
}

async function statMtime(vault: Vault, path: string): Promise<number | null> {
  try {
    return (await vault.adapter.stat(path))?.mtime ?? null;
  } catch {
    return null;
  }
}

function adapterFullPath(vault: Vault, path: string): string | null {
  const adapter = vault.adapter as DataAdapter & { getFullPath?: (p: string) => string };
  try {
    return typeof adapter.getFullPath === "function" ? adapter.getFullPath(path) : null;
  } catch {
    return null;
  }
}

interface NodeExclusiveWriter {
  createExclusive(fullPath: string, body: string): boolean;
  chmod600(fullPath: string): void;
}

function nodeExclusiveWriter(): NodeExclusiveWriter | null {
  try {
    const req = (window as { require?: (id: string) => unknown }).require;
    if (typeof req !== "function") return null;
    const fs = req("fs") as {
      openSync(path: string, flags: string, mode?: number): number;
      writeSync(fd: number, data: string): number;
      closeSync(fd: number): void;
      chmodSync(path: string, mode: number): void;
    };
    return {
      createExclusive(fullPath, body) {
        try {
          // 'wx' fails with EEXIST when the path exists — the O_EXCL
          // atomic create the protocol requires. The mode travels with the
          // create (S-08): owner-only from the first byte, no world-readable
          // window between create and chmod.
          const fd = fs.openSync(fullPath, "wx", 0o600);
          try {
            fs.writeSync(fd, body);
          } finally {
            fs.closeSync(fd);
          }
          return true;
        } catch {
          return false;
        }
      },
      chmod600(fullPath) {
        try {
          fs.chmodSync(fullPath, 0o600);
        } catch {
          // Owner-only is best-effort (S-08); the protocol survives a
          // failed chmod on exotic filesystems.
        }
      },
    };
  } catch {
    return null;
  }
}

/** The host used when node is unavailable: everything unknown, all
 *  verdicts decay by age — the protocol's unknown-host column. */
const NULL_LOCK_HOST: LockHost = {
  hostname: () => null,
  pid: () => null,
  pidAlive: () => null,
};

/** The dirty-lease lifecycle for one open editor view (create on the
 *  first unsaved change, release on a successful save and on close).
 *  Owns its operation id and serializes its IO so a save completing
 *  while an acquire is in flight cannot strand a lease on a clean doc. */
export class EditorLease {
  private opId: string | null = null;
  /** The document path the current lease was created for — release must
   *  target exactly that sidecar even if the file was renamed mid-flight. */
  private opPath: string | null = null;
  private chain: Promise<void> = Promise.resolve();
  private foreignLogged = false;

  constructor(
    private readonly deps: {
      vault: Vault;
      /** Live document path (the view's file — follows renames). */
      filePath: () => string | null;
      /** True while the document holds unsaved changes. */
      hasUnsavedChanges: () => boolean;
      host: LockHost | null;
      onDiag?: (msg: string) => void;
    },
  ) {}

  /** Create the lease when the document is dirty; release it when a sync
   *  finds the document clean (covers the acquire-finishes-after-save
   *  race without stranding a lease on a clean document). No-op without a
   *  node host (mobile, issues/lock-protocol-mobile-scope): no second
   *  local writer exists there, and synced sidecars are foreign noise —
   *  the protocol runs only where the desktop CLI can race the editor. */
  sync(): Promise<void> {
    const run = this.chain.then(async () => {
      if (this.deps.host == null) return;
      const path = this.deps.filePath();
      if (!path) return;
      if (this.opId != null) {
        if (this.opPath === path) return;
        // The document was renamed while dirty (user rename command): the
        // sidecar beside the old name protects nothing and the new name
        // goes to the CLI unprotected. Move it: release pins to the old
        // sidecar (we hold its op_id), then re-acquire beside the new name.
        const opId = this.opId;
        const oldPath = this.opPath;
        this.opId = null;
        this.opPath = null;
        if (oldPath != null) await releaseUmLease(this.deps.vault, oldPath, opId);
        if (!this.deps.hasUnsavedChanges()) return;
      }
      if (!this.deps.hasUnsavedChanges()) return;
      const result = await acquireUmLease(this.deps.vault, path, this.deps.host);
      if (result.ok && result.opId != null) {
        this.opId = result.opId;
        this.opPath = path;
        this.foreignLogged = false;
        if (!this.deps.hasUnsavedChanges()) {
          // The save landed while we were creating the lease — clean up
          // immediately instead of parking a lease on a clean document.
          await releaseUmLease(this.deps.vault, path, this.opId);
          this.opId = null;
          this.opPath = null;
        }
      } else if (result.nameTooLong && !this.foreignLogged) {
        this.foreignLogged = true;
        this.deps.onDiag?.(`lease not created (sidecar name too long): ${path}`);
      } else if (result.foreign && !this.foreignLogged) {
        this.foreignLogged = true;
        this.deps.onDiag?.(`lease not created (foreign lease live): ${path}`);
      }
    });
    this.chain = run.catch(() => {});
    return run;
  }

  /** Release after a successful save (no-op when we hold no lease). The
   *  op_id is kept until the removal is confirmed: a failed removal must
   *  not orphan the sidecar with no owner able to release it — the next
   *  release retries. */
  release(): Promise<void> {
    const run = this.chain.then(async () => {
      const opId = this.opId;
      if (opId == null) return;
      const path = this.opPath;
      if (!path) {
        this.opId = null;
        return;
      }
      const removed = await releaseUmLease(this.deps.vault, path, opId);
      if (removed) {
        this.opId = null;
        this.opPath = null;
      }
    });
    this.chain = run.catch(() => {});
    return run;
  }

  /** Final release on view close — same release, kept distinct for the
   *  call sites' readability. */
  releaseForClose(): Promise<void> {
    return this.release();
  }

  /** op_id of the lease this editor currently holds (null when none): the
   *  desktop save gate matches it to recognize our own sidecar without
   *  relying on pid/host probing alone. */
  currentOpId(): string | null {
    return this.opId;
  }
}
