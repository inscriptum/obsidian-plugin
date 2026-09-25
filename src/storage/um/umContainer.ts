import { unzipSync, zipSync, type Zippable } from "fflate";
import type { JSONContent } from "../../texto/core/@types";
import {
  ASSETS_DIR,
  FROZEN_MTIME,
  MANIFEST_PATH,
  UM_FORMAT,
  UM_TYPE,
  UM_VERSION,
  UmError,
  type UmAssetDescriptor,
  type UmContainerData,
  type UmManifest,
  type UmNoteDescriptor,
} from "./umTypes";

/**
 * Pure core of the `.um` container: parse an archive into an in-memory
 * representation and serialize it back. ZIP is an implementation detail
 * (spec section 4) — all semantics come from the manifest.
 *
 * Compatibility rules implemented here (spec section 12): unknown manifest
 * fields and unknown archive entries survive a round trip untouched; only
 * the five required manifest checks (section 22) can reject a container.
 */

const TEXT_DECODER = new TextDecoder();
const TEXT_ENCODER = new TextEncoder();

function decodeJson(bytes: Uint8Array): unknown {
  return JSON.parse(TEXT_DECODER.decode(bytes));
}

function encodeJson(value: unknown): Uint8Array {
  return TEXT_ENCODER.encode(JSON.stringify(value, null, 2));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse and validate a `.um` archive (spec section 22). Throws UmError. */
export function parseUmContainer(bytes: Uint8Array): UmContainerData {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch (err) {
    throw new UmError(
      "no-manifest",
      `Not a readable UM archive: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const manifestBytes = files[MANIFEST_PATH];
  if (manifestBytes == null) {
    throw new UmError("no-manifest", `Missing ${MANIFEST_PATH}`);
  }
  let manifest: UmManifest;
  try {
    manifest = decodeJson(manifestBytes) as UmManifest;
  } catch (err) {
    throw new UmError(
      "bad-manifest-json",
      `${MANIFEST_PATH} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!isRecord(manifest)) {
    throw new UmError("bad-manifest-json", `${MANIFEST_PATH} is not an object`);
  }
  if (manifest.format !== UM_FORMAT) {
    throw new UmError("bad-format", `format must be "${UM_FORMAT}"`);
  }
  if (manifest.version !== UM_VERSION) {
    throw new UmError(
      "bad-version",
      `Unsupported UM version: ${String(manifest.version)}`,
    );
  }
  if (manifest.type !== UM_TYPE) {
    throw new UmError(
      "bad-type",
      `Unsupported container type: ${String(manifest.type)}`,
    );
  }
  if (!Array.isArray(manifest.notes)) {
    throw new UmError("bad-notes", "manifest.notes must be an array");
  }

  const notes = new Map<string, JSONContent>();
  const seenIds = new Set<string>();
  const seenPaths = new Set<string>();
  const claimedPaths = new Set<string>([MANIFEST_PATH]);

  for (const raw of manifest.notes) {
    if (!isRecord(raw)) {
      throw new UmError(
        "bad-descriptor",
        "Every note descriptor must be an object",
      );
    }
    const { id, path, order } = raw as Partial<UmNoteDescriptor>;
    if (typeof id !== "string" || id.length === 0) {
      throw new UmError("bad-descriptor", "Note descriptor is missing an id");
    }
    if (typeof path !== "string" || path.length === 0) {
      throw new UmError("bad-descriptor", `Note "${id}" is missing a path`);
    }
    if (typeof order !== "number" || !Number.isFinite(order)) {
      throw new UmError("bad-descriptor", `Note "${id}" has an invalid order`);
    }
    if (raw.title !== undefined && typeof raw.title !== "string") {
      throw new UmError("bad-descriptor", `Note "${id}" has an invalid title`);
    }
    if (raw.expanded !== undefined && typeof raw.expanded !== "boolean") {
      throw new UmError(
        "bad-descriptor",
        `Note "${id}" has an invalid expanded flag`,
      );
    }
    if (seenIds.has(id)) {
      throw new UmError("duplicate-id", `Duplicate note id: ${id}`);
    }
    if (seenPaths.has(path)) {
      throw new UmError("bad-descriptor", `Duplicate note path: ${path}`);
    }
    seenIds.add(id);
    seenPaths.add(path);
    claimedPaths.add(path);
  }

  const loadedPaths = new Map<string, JSONContent>();
  for (const descriptor of manifest.notes as UmNoteDescriptor[]) {
    let doc = loadedPaths.get(descriptor.path);
    if (doc === undefined) {
      const noteBytes = files[descriptor.path];
      if (noteBytes == null) {
        throw new UmError(
          "missing-note",
          `Note document not found in archive: ${descriptor.path}`,
        );
      }
      try {
        doc = decodeJson(noteBytes) as JSONContent;
      } catch (err) {
        throw new UmError(
          "bad-note-json",
          `${descriptor.path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      if (!isRecord(doc)) {
        throw new UmError(
          "bad-note-json",
          `${descriptor.path} is not an object`,
        );
      }
      loadedPaths.set(descriptor.path, doc);
    }
    notes.set(descriptor.id, doc);
  }

  const assets = new Map<string, Uint8Array>();
  const assetDescriptors = readAssetDescriptors(manifest);
  for (const asset of assetDescriptors) {
    claimedPaths.add(asset.path);
    const bytes = files[asset.path];
    // A missing asset is a broken image, not a broken notepad (spec 22:
    // invalid optional extensions must not make the container unreadable).
    if (bytes != null) assets.set(asset.id, bytes);
  }

  // Everything we don't understand is carried over verbatim (spec 3, 12).
  const unknownEntries = new Map<string, Uint8Array>();
  for (const [path, content] of Object.entries(files)) {
    if (!claimedPaths.has(path)) {
      unknownEntries.set(path, content);
    }
  }

  return { manifest, notes, assets, unknownEntries };
}

/** Read the optional asset registry from a manifest, tolerating junk: an
 *  invalid `assets` value degrades to "no assets" instead of rejecting the
 *  container (spec 12.2). Duplicate entries keep their first occurrence. */
export function readAssetDescriptors(
  manifest: UmManifest,
): UmAssetDescriptor[] {
  const raw = manifest.assets;
  if (!Array.isArray(raw)) return [];
  const out: UmAssetDescriptor[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (!isRecord(entry)) continue;
    const { id, path } = entry as Partial<UmAssetDescriptor>;
    if (typeof id !== "string" || typeof path !== "string") continue;
    if (id.length === 0 || path.length === 0 || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      path,
      type: typeof entry.type === "string" ? entry.type : undefined,
      size: typeof entry.size === "number" ? entry.size : undefined,
    });
  }
  return out;
}

function writeAssetDescriptors(
  manifest: UmManifest,
  assets: UmAssetDescriptor[],
): void {
  if (assets.length === 0) {
    delete manifest.assets;
  } else {
    manifest.assets = assets;
  }
}

/** Serialize the container deterministically: fixed timestamps, fixed entry
 *  order, pretty-printed JSON. Assets and unknown entries are stored
 *  uncompressed (level 0) — images are already compressed and unknown
 *  entries must not be mangled. */
export function serializeUmContainer(data: UmContainerData): Uint8Array {
  const sorted = sortNoteDescriptors(data.manifest.notes);
  reindexOrders(sorted);

  const entries: Zippable = {};
  entries[MANIFEST_PATH] = encodeJson(data.manifest);

  const writtenPaths = new Set<string>();
  for (const descriptor of sorted) {
    if (writtenPaths.has(descriptor.path)) continue;
    writtenPaths.add(descriptor.path);
    const doc = data.notes.get(descriptor.id);
    if (doc == null) continue;
    entries[descriptor.path] = encodeJson(doc);
  }

  for (const asset of readAssetDescriptors(data.manifest)) {
    const bytes = data.assets.get(asset.id);
    if (bytes == null) continue;
    entries[asset.path] = [bytes, { level: 0, mtime: FROZEN_MTIME }];
  }

  for (const [path, bytes] of data.unknownEntries) {
    entries[path] = [bytes, { level: 0, mtime: FROZEN_MTIME }];
  }

  return zipSync(entries, { mtime: FROZEN_MTIME, level: 6 });
}

/** Notes ordered by explicit `order`, ties broken by manifest order (spec 7:
 *  ordering must never come from the archive or the filesystem). */
export function sortNoteDescriptors(
  notes: UmNoteDescriptor[],
): UmNoteDescriptor[] {
  return notes
    .map((descriptor, index) => ({ descriptor, index }))
    .sort(
      (a, b) => a.descriptor.order - b.descriptor.order || a.index - b.index,
    )
    .map(({ descriptor }) => descriptor);
}

/** Make `order` values contiguous and zero-based after every mutation (spec
 *  8.3: "SHOULD be unique and contiguous"). */
export function reindexOrders(notes: UmNoteDescriptor[]): void {
  notes.forEach((descriptor, index) => {
    descriptor.order = index;
  });
}

/** Build the recommended archive path for a new note document (spec 8.2). */
export function notePathForId(id: string): string {
  return `notes/${id}.json`;
}

function sanitizeExtension(ext: string): string {
  const clean = ext.toLowerCase().replace(/[^a-z0-9]/g, "");
  return clean.length > 0 && clean.length <= 8 ? clean : "bin";
}

/** Archive extension for a new asset, derived from the file name (preferred)
 *  or the MIME type. */
export function assetExtension(filename: string, mime?: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot >= 0 && dot < filename.length - 1) {
    return sanitizeExtension(filename.slice(dot + 1));
  }
  const fromMime = mime?.split("/")[1];
  if (fromMime) return sanitizeExtension(fromMime.split("+")[0]);
  return "bin";
}

/** Build the recommended archive path for an asset (spec section 17). */
export function assetPathForId(id: string, ext: string): string {
  return `${ASSETS_DIR}/${id}.${ext}`;
}

/** Walk a note document and collect the asset ids its image nodes reference.
 *  A reference is an image node whose `data.id` names an entry of the given
 *  asset id set — anything else is an external vault link and is ignored. */
export function collectReferencedAssetIds(
  doc: JSONContent,
  assetIds: Set<string>,
  into: Set<string> = new Set<string>(),
): Set<string> {
  const data = doc.attrs?.data as { id?: unknown } | undefined;
  if (doc.type === "image" && typeof data?.id === "string") {
    if (assetIds.has(data.id)) into.add(data.id);
  }
  if (Array.isArray(doc.content)) {
    for (const child of doc.content) {
      collectReferencedAssetIds(child, assetIds, into);
    }
  }
  return into;
}
