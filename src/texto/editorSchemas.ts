import type { Extensions } from "./core/@types";
import type { ExtensionHooks } from "./getExtensions";
import { getExtensions, type GetExtensionsOptions } from "./getExtensions";
import { ExtensionManager } from "./core/ExtensionManager";
import { getSchemaByResolvedExtensions } from "./core/helpers/getSchemaByResolvedExtensions";
import type { Schema } from "prosemirror-model";

/**
 * Named editor profiles (spec 8.6): one composition of extensions per
 * schema family. All profiles share the same plugin set — only the top
 * node and the header nodes differ, so "one set of plugins, different
 * schemas" holds without hand-written ProseMirror specs.
 *
 * Versioning (8.6.1): the manifest stores `schema` + `schemaVersion`; the
 * current version of every family lives in the storage layer
 * (src/storage/um/umSchemas.ts). A schema-shape change here without a
 * version bump is caught by the snapshot test in editorSchemas.test.ts.
 */

export type EditorProfileId = "note" | "title" | "plain";

export interface EditorProfile {
  id: EditorProfileId;
  /** Manifest schema family this profile edits ("note" is the plain .note
   *  view's profile and never appears in a `.um` manifest). */
  family: string | null;
  /** Name of the profile's top node in the built schema. */
  topNode: string;
}

export const EDITOR_PROFILES: Record<EditorProfileId, EditorProfile> = {
  note: { id: "note", family: null, topNode: "noteDoc" },
  title: { id: "title", family: "title", topNode: "noteDoc" },
  plain: { id: "plain", family: "plain", topNode: "noteDoc" },
};

/** Build the extension set of a profile. The "note" profile is the
 *  historical composition (used by the plain .note view). */
export function getProfileExtensions(
  profile: EditorProfileId,
  hooks: ExtensionHooks = {},
  options: GetExtensionsOptions = {},
): Extensions {
  return getExtensions(hooks, { ...options, profile });
}

/** Resolve a profile's extensions into the ProseMirror schema (same path
 *  the editor uses: resolve addExtensions first, then build). */
export function getProfileSchema(
  profile: EditorProfileId,
  hooks: ExtensionHooks = {},
  options: GetExtensionsOptions = {},
): Schema {
  const resolved = ExtensionManager.resolve(
    getProfileExtensions(profile, hooks, options),
  );
  return getSchemaByResolvedExtensions(resolved);
}
