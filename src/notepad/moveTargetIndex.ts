/** Destination index for "move page X right after page Y" (the phone
 *  Move… sheet, design S6). Index math must match UmNotepad.moveNote,
 *  which SPLICES THE MOVING ITEM OUT FIRST — the tapped page's index
 *  shifts down by one when it sat below the mover:
 *
 *  [T, A, B, C]  move A, tap B  → tap index 2, mover above → 2
 *    remove A → [T, B, C], insert@2 → [T, B, A, C]  (A right after B ✓)
 *  [T, A, B, C]  move C, tap A  → tap index 1, mover below → 2
 *    remove C → [T, A, B], insert@2 → [T, A, C, B]  (C right after A ✓)
 */
export function moveTargetIndex(
  notes: ReadonlyArray<{ id: string }>,
  movingId: string,
  tappedId: string,
): number | null {
  const movingIndex = notes.findIndex((n) => n.id === movingId);
  const tappedIndex = notes.findIndex((n) => n.id === tappedId);
  if (movingIndex < 0 || tappedIndex < 0) return null;
  return tappedIndex + (movingIndex < tappedIndex ? 0 : 1);
}
