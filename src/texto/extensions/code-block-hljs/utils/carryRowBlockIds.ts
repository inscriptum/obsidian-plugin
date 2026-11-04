import type { Node as ProseMirrorNode } from "prosemirror-model";

import type { JSONContent } from "../../../core/@types";
import {
  generateBlockIdAvoiding,
  isBlockId,
} from "../../block-ids/generateBlockId";

/**
 * Carry the current rows' block ids onto the rows regenerated from plain
 * text (issue code-block-row-ids).
 *
 * The code-block node view rebuilds the block's rows from hljs-highlighted
 * HTML on every content change and swaps the content in place — OUTSIDE any
 * ProseMirror transaction, so the block-ids plugin never sees the new rows
 * and they arrive without ids. Every save then "repairs" the missing ids (a
 * console warning per save) and every repair generates NEW ids, so a row's
 * address churns on every save made while editing the block — the block-ids
 * storage contract (spec um-cli §4.4–4.5) demands stability.
 *
 * Rows map 1:1 by index (same source text ⇒ same line count); rows without
 * a donor — or with a donor id already handed out within this batch — get
 * fresh ids from the block-id grammar. The JSON is mutated in place; the
 * caller owns it.
 */
export function carryRowBlockIds(
  freshBlockJson: JSONContent,
  currentRows: readonly ProseMirrorNode[],
): void {
  const rows = freshBlockJson.content;
  if (!Array.isArray(rows)) return;

  // The collision universe: every valid donor id, so a generated id never
  // collides with any of them (including the ones carried later).
  const donors = new Set<string>();
  for (const row of currentRows) {
    const id: unknown = row.attrs?.id;
    if (isBlockId(id)) donors.add(id);
  }
  // Ids handed out so far — a donor id may be carried only once.
  const handedOut = new Set<string>();

  for (let i = 0; i < rows.length; i += 1) {
    const donorId: unknown = currentRows[i]?.attrs?.id;
    const id =
      isBlockId(donorId) && !handedOut.has(donorId)
        ? donorId
        : generateBlockIdAvoiding(donors);
    handedOut.add(id);
    rows[i] = { ...rows[i], attrs: { ...(rows[i].attrs ?? {}), id } };
  }
}
