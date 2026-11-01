import { Extension } from "../../core";

import { BlockIdAttributes, blockIdAttribute } from "./blockIdAttrs";
import { createBlockIdsPlugin } from "./plugins/blockIds.plugin";

export interface BlockIdsOptions {
  /** Reserved for future needs (per-feature toggles); the feature itself is
   *  always on — every addressable block carries an id. */
  enabled?: boolean;
}

/**
 * Stable unique ids on every addressable block (spec um-cli v0.3 §4.4–4.5).
 *
 * Storage: attrs.id on the node (single canonical place; the DOM projects
 * it as data-id). Assignment mechanics reuse the state extension's
 * appendTransaction walk over changed ranges — with the differences the
 * performance spike (issue block-ids, 2026-10-31) made mandatory:
 *  - no per-block decorations (444 ms/keystroke at 5k blocks — the state
 *    decoration set rebuild is O(D²) per transaction);
 *  - legacy documents are tagged at the JSON level before editor creation
 *    (assignBlockIds), not with a whole-document transaction (+7.3 s at
 *    20k blocks).
 *
 * Lifecycle (spec §4.5, covered by blockIds.test.ts): text/attr edits and
 * moves keep ids; undo/redo restores them verbatim (history replays this
 * plugin's fix-ups together with the edit); splits keep the original id on
 * the first part; pastes and duplicates get fresh ids, including pastes
 * arriving from another note; the doc-wide duplicate net runs on the save
 * path (ensureUniqueBlockIds) — a document with duplicate ids is never
 * written.
 */
export const BlockIds = new Extension<BlockIdsOptions>({
  name: "blockIds",
  priority: 1999,

  addGlobalAttributes() {
    return [blockIdAttribute()];
  },

  addProseMirrorPlugins() {
    return [createBlockIdsPlugin()];
  },
});

export { BlockIdAttributes };
export {
  assignBlockIds,
  reassignBlockIds,
  ensureUniqueBlockIds,
  type UniqueBlockIdsResult,
} from "./assignBlockIds";
export { BLOCK_IDS_EXTERNAL_CONTENT } from "./plugins/blockIds.plugin";
export {
  BLOCK_ID_LENGTH,
  BLOCK_ID_PATTERN,
  generateBlockId,
  generateBlockIdAvoiding,
  isBlockId,
} from "./generateBlockId";
export { BLOCK_ID_TYPES, isBlockIdType } from "./blockIdAttrs";
