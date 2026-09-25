import type { JSONContent } from "../../texto/core/@types";

/** UM container format identifier (spec section 6.1). */
export const UM_FORMAT = "um";
/** The only UM container version this implementation reads/writes (6.2). */
export const UM_VERSION = 1;
/** The only container type defined by UM 1.0 (6.3). */
export const UM_TYPE = "notepad";
/** Manifest entry point inside the archive (section 5). */
export const MANIFEST_PATH = "manifest.json";
/** Recommended location of note documents (section 8.2). */
export const NOTES_DIR = "notes";
/** Location of packed images (section 17). */
export const ASSETS_DIR = "assets";

/** Frozen timestamp written into every ZIP entry: deterministic output, so
 *  two saves of identical content produce identical bytes. */
export const FROZEN_MTIME = new Date(Date.UTC(1980, 0, 1));

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
  | "bad-note-json";

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
