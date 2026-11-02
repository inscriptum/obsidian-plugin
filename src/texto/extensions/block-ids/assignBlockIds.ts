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

/** Replace EVERY id in the document with a fresh one (existing ids are
 *  never reused). For copies that arrive as whole notes — duplicating a
 *  notepad page duplicates its content JSON verbatim, ids included, and
 *  ids must be unique per note (spec um-cli §4.5: a transfer between notes
 *  gets fresh ids in the target). */
export function reassignBlockIds(doc: JSONContent): JSONContent {
  const used = new Set<string>();
  return assignIn(doc, used, true);
}

export interface StoredBlockIdsRepair {
  /** The repaired document — the input reference when nothing was wrong. */
  doc: JSONContent;
  fixed: boolean;
  /** Duplicate ids that were replaced (diagnostics). */
  replaced: string[];
  /** Missing/invalid ids that were filled (diagnostics). */
  filled: number;
}

/** The save net over STORED page JSON (review PR #19 CR-33): pages that
 *  never opened in this session have no editor, so the editor-level net
 *  never sees them — a notepad loaded with duplicate or invalid ids on a
 *  collapsed page would write them back as-is. Same rules as
 *  ensureUniqueBlockIds: the first occurrence in document order keeps its
 *  id, later duplicates get fresh ones, missing/invalid values are filled.
 *  Defect-free documents are returned by reference — no copy, no churn. */
export function repairStoredBlockIds(doc: JSONContent): StoredBlockIdsRepair {
  // Pass A — defect scan, no allocation.
  const seen = new Set<string>();
  let duplicates = 0;
  let missing = 0;
  const scan = (node: JSONContent): void => {
    if (node.type != null && isBlockIdType(node.type)) {
      const id: unknown = node.attrs?.id;
      if (!isBlockId(id)) missing += 1;
      else if (seen.has(id)) duplicates += 1;
      else seen.add(id);
    }
    if (Array.isArray(node.content)) {
      for (const child of node.content) scan(child);
    }
  };
  scan(doc);

  if (duplicates === 0 && missing === 0) {
    return { doc, fixed: false, replaced: [], filled: 0 };
  }

  // Pass B — rebuild with the same document-order rules. seenNow starts
  // EMPTY and accumulates during the walk: seeding it with the scan's
  // result would count the first occurrence as a duplicate too.
  const used = new Set<string>(seen);
  const replaced: string[] = [];
  let filled = 0;
  const seenNow = new Set<string>();
  const repair = (node: JSONContent): JSONContent => {
    const next: JSONContent = { ...node };
    if (next.type != null && isBlockIdType(next.type)) {
      const attrs = { ...((next.attrs ?? {}) as Record<string, unknown>) };
      const id: unknown = attrs.id;
      if (isBlockId(id) && !seenNow.has(id)) {
        seenNow.add(id);
      } else {
        const fresh = generateBlockIdAvoiding(used);
        used.add(fresh);
        attrs.id = fresh;
        next.attrs = attrs;
        if (isBlockId(id)) replaced.push(id);
        else filled += 1;
      }
    }
    if (Array.isArray(next.content)) {
      next.content = next.content.map(repair);
    }
    return next;
  };
  const fixedDoc = repair(doc);
  return { doc: fixedDoc, fixed: true, replaced, filled };
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

function assignIn(
  node: JSONContent,
  used: Set<string>,
  force = false,
): JSONContent {
  const next: JSONContent = { ...node };
  if (next.type != null && isBlockIdType(next.type)) {
    const attrs = { ...((next.attrs ?? {}) as Record<string, unknown>) };
    if (force || !isBlockId(attrs.id)) {
      const id = generateBlockIdAvoiding(used);
      attrs.id = id;
      used.add(id);
      next.attrs = attrs;
    }
  }
  if (Array.isArray(next.content)) {
    next.content = next.content.map((child) => assignIn(child, used, force));
  }
  return next;
}

export interface UniqueBlockIdsResult {
  /** True when anything was repaired (duplicates replaced or fills made). */
  fixed: boolean;
  /** The duplicate ids that were replaced (diagnostics). */
  replaced: string[];
  /** How many blocks were missing a grammar-valid id and got one filled in
   *  (diagnostics; 0 when the doc was complete). */
  filled: number;
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
    return { fixed: false, replaced: [], filled: 0 };
  }

  const doc = editor.state.doc;
  const seen = new Set<string>();
  const duplicates: { id: string; pos: number }[] = [];
  let missing = 0;
  doc.descendants((node, pos) => {
    if (!isBlockIdType(node.type.name)) return true;
    const id: unknown = node.attrs.id;
    if (!isBlockId(id)) {
      // A non-grammar value counts as "no id": the save net must not let an
      // invalid id through, and a duplicate pair of invalid ids must be
      // re-id'd just like a real duplicate.
      missing += 1;
      return true;
    }
    if (seen.has(id)) duplicates.push({ id, pos });
    else seen.add(id);
    return true;
  });

  if (duplicates.length === 0 && missing === 0) {
    return { fixed: false, replaced: [], filled: 0 };
  }

  const used = new Set<string>(seen);
  const replaced: string[] = [];
  let filled = 0;
  const tr = view.state.tr;
  for (const { id, pos } of duplicates) {
    // AttrStep (not setNodeMarkup): an attribute-only repair must not
    // behave like a content replace — see blockIds.plugin.ts.
    const fresh = generateBlockIdAvoiding(used);
    used.add(fresh);
    tr.step(new AttrStep(pos, "id", fresh));
    replaced.push(id);
  }
  if (missing > 0) {
    // Fill the grammar-invalid / missing ids with fresh ones (document
    // order, after the duplicates — same walk shape).
    const seenNow = new Set<string>();
    tr.doc.descendants((node, pos) => {
      if (!isBlockIdType(node.type.name)) return true;
      const id: unknown = node.attrs.id;
      if (isBlockId(id)) {
        if (seenNow.has(id)) return true;
        seenNow.add(id);
        return true;
      }
      const fresh = generateBlockIdAvoiding(used);
      used.add(fresh);
      tr.step(new AttrStep(pos, "id", fresh));
      filled += 1;
      return true;
    });
  }
  tr.setMeta("addToHistory", false);
  view.dispatch(tr);

  return { fixed: true, replaced, filled };
}
