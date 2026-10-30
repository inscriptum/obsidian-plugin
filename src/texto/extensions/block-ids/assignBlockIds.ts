import type { Editor } from "../../core/Editor";
import type { JSONContent } from "../../core/@types";
import { AttrStep } from "prosemirror-transform";

import { isBlockIdType } from "./blockIdAttrs";
import {
  generateBlockIdAvoiding,
  isBlockId,
} from "./generateBlockId";

/** Assign an id to every addressable block of a document that does not have
 *  one yet. Ids already present are kept and seeded into the collision set,
 *  so a legacy document loaded by a newer one keeps its ids and a doc whose
 *  ids were written by an old (attr-dropping) version gets fresh ones.
 *
 *  This is the LOAD path (issue block-ids, spike verdict): legacy documents
 *  are tagged in their JSON before the editor parses them. The
 *  state-extension pattern (one transaction walking the whole document)
 *  measured +7.3 s on a 20 000-block document (steps accumulate O(N²));
 *  the JSON walk is linear and measured 19 ms on the same document. The
 *  cost is paid once per document — the next save stores the ids. */
export function assignBlockIds(doc: JSONContent): JSONContent {
  const used = new Set<string>();
  collectIds(doc, used);
  return assignIn(doc, used);
}

function collectIds(node: JSONContent, used: Set<string>): void {
  if (node.type != null && isBlockIdType(node.type)) {
    const id = (node.attrs as { id?: unknown } | undefined)?.id;
    if (isBlockId(id)) used.add(id);
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) collectIds(child, used);
  }
}

function assignIn(node: JSONContent, used: Set<string>): JSONContent {
  const next: JSONContent = { ...node };
  if (next.type != null && isBlockIdType(next.type)) {
    const attrs = { ...((next.attrs ?? {}) as Record<string, unknown>) };
    if (!isBlockId(attrs.id)) {
      const id = generateBlockIdAvoiding(used);
      attrs.id = id;
      used.add(id);
      next.attrs = attrs;
    }
  }
  if (Array.isArray(next.content)) {
    next.content = next.content.map((child) => assignIn(child, used));
  }
  return next;
}

export interface UniqueBlockIdsResult {
  /** True when at least one duplicate id was replaced. */
  fixed: boolean;
  /** The duplicate ids that were replaced (diagnostics). */
  replaced: string[];
}

/** Doc-wide uniqueness net for the save path (spec um-cli §4.5: a document
 *  with duplicate ids must not be written; the conflict is fixed before the
 *  write and reported). The first block in document order keeps its id,
 *  every later duplicate gets a fresh one. The fix-up transaction is
 *  excluded from undo history: it repairs storage data, it is not an edit.
 *
 *  Returns what was fixed so the caller can log diagnostics; when the
 *  document is clean nothing is dispatched. */
export function ensureUniqueBlockIds(editor: Editor): UniqueBlockIdsResult {
  const view = editor.view;
  if (view == null || editor.isDestroyed) {
    return { fixed: false, replaced: [] };
  }

  const doc = editor.state.doc;
  const seen = new Set<string>();
  const duplicates: { id: string; pos: number }[] = [];
  doc.descendants((node, pos) => {
    if (!isBlockIdType(node.type.name)) return true;
    const id: unknown = node.attrs.id;
    if (!isBlockId(id)) return true;
    if (seen.has(id)) duplicates.push({ id, pos });
    else seen.add(id);
    return true;
  });

  if (duplicates.length === 0) {
    return { fixed: false, replaced: [] };
  }

  const used = new Set<string>(seen);
  const replaced: string[] = [];
  const tr = view.state.tr;
  for (const { id, pos } of duplicates) {
    // AttrStep (not setNodeMarkup): an attribute-only repair must not
    // behave like a content replace — see blockIds.plugin.ts.
    const fresh = generateBlockIdAvoiding(used);
    used.add(fresh);
    tr.step(new AttrStep(pos, "id", fresh));
    replaced.push(id);
  }
  tr.setMeta("addToHistory", false);
  view.dispatch(tr);

  return { fixed: true, replaced };
}
