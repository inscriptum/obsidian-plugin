import type { JSONContent } from "../../texto/core/@types";

/** UM container format identifier (spec section 6.1). */
export const UM_FORMAT = "um";
/** The only UM container version this implementation reads/writes (6.2). */
export const UM_VERSION = 1;
/** The only container type defined by UM 1.0 (6.3). */
export const UM_TYPE = "notepad";

/** Note schema family of the title page (spec 8.6): mandatory title and
 *  summary header, followed by content blocks (9.1). */
export const UM_SCHEMA_TITLE = "title";
/** Note schema family of a regular note (spec 8.6): content blocks only,
 *  a title node is not required (9.2). */
export const UM_SCHEMA_PLAIN = "plain";
/** Current version of every schema family this editor reads/writes (8.6.1).
 *  Raised only for breaking changes; additive changes keep the value.
 *  v2: table cells accept an image node — the content-expression shape
 *  changed (editorSchemas.test pins it). v1 documents stay valid; older
 *  editors degrade a v2 page to "unsupported" instead of failing to parse
 *  it (image-in-cell is unparseable for them). */
export const UM_SCHEMA_VERSION = 2;
/** Manifest entry point inside the archive (section 5). */
export const MANIFEST_PATH = "manifest.json";
/** Recommended location of note documents (section 8.2). */
export const NOTES_DIR = "notes";
/** Location of packed images (section 17). */
export const ASSETS_DIR = "assets";

/** Frozen timestamp written into every ZIP entry: deterministic output, so
 *  two saves of identical content produce identical bytes. */
export const FROZEN_MTIME = new Date(Date.UTC(1980, 0, 1));

/** Size guards against hostile `.um` files (zip bombs). A vault-synced
 *  archive must never be read or decompressed past these bounds. The
 *  compressed cap bounds what `readBinary` loads; the inflated cap bounds
 *  what `unzipSync` allocates — enforced per entry from the ZIP central
 *  directory's declared sizes, before that entry is decompressed. Both are
 *  far above any container this plugin can produce (images are stored
 *  uncompressed, so file size ≈ media size; JSON notes deflate by factors,
 *  not orders of magnitude). */
export const UM_MAX_FILE_BYTES = 256 * 1024 * 1024;
export const UM_MAX_INFLATED_BYTES = 512 * 1024 * 1024;

export interface UmNoteDescriptor {
  /** Stable unique identifier (spec 8.1) — never derived from position. */
  id: string;
  /** Archive path of the serialized note document (8.2). */
  path: string;
  /** Position within the notepad (8.3). */
  order: number;
  /** Display title. Optional per spec; our implementation always writes it. */
  title?: string;
  /** Notepad UI expanded state. Absent or false = collapsed (the spec's
   *  initial default); we write it only for expanded notes. */
  expanded?: boolean;
  /** Document schema family (8.6). Absent = legacy container: inferred on
   *  load (order 0 → title, otherwise plain) and written back on save. */
  schema?: string;
  /** Version of the schema family (8.6). Absent = legacy: inferred on load
   *  as the current version. Never lowered on rewrite (8.6.2). */
  schemaVersion?: number;
  /** Epoch ms of the page content's last change. Stamped by setNoteContent
   *  (real changes only) and at page creation/duplication. Absent = legacy
   *  page never edited by a build that tracks it — the view then falls
   *  back to the container file's mtime for display. Additive field:
   *  older builds preserve it verbatim. */
  modifiedAt?: number;
}

export interface UmAssetDescriptor {
  id: string;
  path: string;
  /** MIME type, when known. */
  type?: string;
  /** Byte size, when known. */
  size?: number;
}

/** The manifest is kept as a plain record so unknown fields (spec 12.1) and
 *  unknown features (12.2) survive a load→save round trip untouched: we only
 *  mutate the fields we know. */
export interface UmManifest {
  format: string;
  version: number;
  type: string;
  notes: UmNoteDescriptor[];
  assets?: UmAssetDescriptor[];
  [key: string]: unknown;
}

/** Parsed in-memory representation of a `.um` archive. */
export interface UmContainerData {
  manifest: UmManifest;
  /** Note documents by note id. */
  notes: Map<string, JSONContent>;
  /** Asset bytes by asset id. */
  assets: Map<string, Uint8Array>;
  /** Archive entries we don't understand (spec 3, 12) — preserved verbatim
   *  on save. Includes notes/assets files not listed in the manifest. */
  unknownEntries: Map<string, Uint8Array>;
}

export type UmErrorCode =
  | "no-manifest"
  | "bad-manifest-json"
  | "bad-format"
  | "bad-version"
  | "bad-type"
  | "bad-notes"
  | "bad-descriptor"
  | "duplicate-id"
  | "missing-note"
  | "bad-note-json"
  | "too-large";

/** Parse/serialize failure with a stable machine-readable code, so callers
 *  can show a precise message without string matching. */
export class UmError extends Error {
  code: UmErrorCode;

  constructor(code: UmErrorCode, message: string) {
    super(message);
    this.name = "UmError";
    this.code = code;
  }
}
