import type { JSONContent } from "../../texto/core/@types";
import {
  UM_SCHEMA_PLAIN,
  UM_SCHEMA_TITLE,
  UM_SCHEMA_VERSION,
  type UmNoteDescriptor,
} from "./umTypes";

/**
 * Format-level registry of note schema families (spec 8.6): which families
 * this editor knows, their current versions, and the migration chains from
 * older versions. Editor-facing composition (extensions per family) lives
 * in src/texto/editorSchemas.ts — this module stays JSON-only so the
 * storage layer never depends on the editor.
 *
 * Versioning policy (8.6.1): a version is raised only for breaking
 * changes; additive changes keep the value. Older documents are handled by
 * migrations, never by retained editor variants.
 */

/** Interpretation of a note descriptor for this editor (spec 8.6.2). */
export type UmSchemaState =
  /** Known family at a version this editor opens. `family` selects the
   *  editor profile; a `version` older than current needs a migration run
   *  first (migrateNoteDoc). */
  | { kind: "openable"; family: string; version: number }
  /** Newer version of a known family, or a family this editor does not
   *  know — such a document can only come from a newer editor. The page is
   *  shown as a notice, never edited, and preserved verbatim on rewrite. */
  | { kind: "unsupported"; family: string | null; version: number | null }
  /** Known family, older version, and the migration chain failed. Same
   *  UI treatment as "unsupported"; preserved verbatim on rewrite. */
  | { kind: "invalid"; family: string };

/** Current version of a schema family; null for unknown families. */
export function currentSchemaVersion(family: string): number | null {
  return family === UM_SCHEMA_TITLE || family === UM_SCHEMA_PLAIN
    ? UM_SCHEMA_VERSION
    : null;
}

/** Legacy inference (8.6.2): fields absent → order 0 is the title page,
 *  every other note is plain; the version is the current one. */
export function inferSchemaFields(order: number): {
  schema: string;
  schemaVersion: number;
} {
  return {
    schema: order === 0 ? UM_SCHEMA_TITLE : UM_SCHEMA_PLAIN,
    schemaVersion: UM_SCHEMA_VERSION,
  };
}

/**
 * Resolve a descriptor against this editor's knowledge. Pure — no I/O, no
 * migration runs here; the caller migrates "openable at an older version"
 * before treating the note as openable (see migrateNoteDoc).
 */
export function interpretSchema(
  descriptor: Pick<UmNoteDescriptor, "schema" | "schemaVersion" | "order">,
): UmSchemaState {
  // Absent fields are legacy (written before schemas existed): infer.
  const family = descriptor.schema ?? inferSchemaFields(descriptor.order).schema;
  const version = descriptor.schemaVersion ?? UM_SCHEMA_VERSION;

  const current = currentSchemaVersion(family);
  if (current == null) {
    return { kind: "unsupported", family, version };
  }
  if (version > current) {
    return { kind: "unsupported", family, version };
  }
  return { kind: "openable", family, version };
}

/**
 * Migration chains: family → fromVersion → transform to fromVersion + 1.
 * A breaking change to a family registers its transform (see
 * registerMigration) and bumps UM_SCHEMA_VERSION.
 */
const MIGRATIONS: Record<
  string,
  Record<number, ((doc: JSONContent) => JSONContent) | undefined>
> = {
  [UM_SCHEMA_TITLE]: {},
  [UM_SCHEMA_PLAIN]: {},
};

// v1 → v2 (table cells accept an image node): purely additive, every v1
// document is already a valid v2 document — the bump only marks the new
// shape so older editors degrade the page to "unsupported" (8.6.2) instead
// of failing to parse it.
registerMigration(UM_SCHEMA_TITLE, 1, (doc) => doc);
registerMigration(UM_SCHEMA_PLAIN, 1, (doc) => doc);

/** Register the v(n) → v(n+1) transform of a family (8.6.3): a
 *  deterministic JSON→JSON migration. Called from version-bump commits. */
export function registerMigration(
  family: string,
  fromVersion: number,
  transform: (doc: JSONContent) => JSONContent,
): void {
  const chain = (MIGRATIONS[family] ??= {});
  chain[fromVersion] = transform;
}

export interface UmMigrationResult {
  ok: boolean;
  doc: JSONContent;
  /** Version the returned doc is at when ok. */
  toVersion: number;
}

/** Apply a chain of steps in order; any throwing step fails the whole run
 *  with the original doc untouched. Extracted pure so the chain mechanics
 *  are testable before the first real version bump exists. */
export function runMigrationChain(
  steps: Array<(doc: JSONContent) => JSONContent>,
  doc: JSONContent,
  toVersion: number,
): UmMigrationResult {
  let result = doc;
  try {
    for (const step of steps) {
      result = step(result);
    }
  } catch {
    return { ok: false, doc, toVersion };
  }
  return { ok: true, doc: result, toVersion };
}

/**
 * Run the migration chain from `fromVersion` to the current version of the
 * family. Deterministic JSON→JSON transforms (8.6.3). A throwing transform
 * is reported as { ok: false } — the caller degrades that page to
 * "unsupported" and preserves the original doc and descriptor untouched.
 */
export function migrateNoteDoc(
  family: string,
  fromVersion: number,
  doc: JSONContent,
): UmMigrationResult {
  const current = currentSchemaVersion(family);
  if (current == null || fromVersion >= current) {
    return { ok: false, doc, toVersion: fromVersion };
  }
  const steps: Array<(doc: JSONContent) => JSONContent> = [];
  for (let v = fromVersion; v < current; v++) {
    const step = MIGRATIONS[family]?.[v];
    if (step == null) return { ok: false, doc, toVersion: fromVersion };
    steps.push(step);
  }
  return runMigrationChain(steps, doc, current);
}
