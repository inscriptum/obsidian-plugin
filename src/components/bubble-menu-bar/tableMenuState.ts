import type { EditorState } from 'prosemirror-state';
import { CellSelection, isInTable, rowIsHeader, selectedRect, selectionCell } from 'prosemirror-tables';

export interface TableMenuState {
  inTable: boolean;
  /** 2+ cells selected (CellSelection) — "Merge" operation is active. */
  multiCell: boolean;
  /** Current cell is merged (colspan/rowspan > 1) — "Split" operation is active. */
  mergedCell: boolean;
  /** First row is header (th). */
  headerRow: boolean;
  /** backgroundColor attribute of the current cell. */
  bg: string | null;
  /** dataColor attribute of the current cell. */
  textColor: string | null;
}

/**
 * Active state of the table bubble menu panel based on the current selection.
 * Pure function of EditorState — testable on a real schema (see test).
 */
export function getTableMenuState(state: EditorState): TableMenuState {
  const sel = state.selection;
  const cellSel = sel instanceof CellSelection;
  const inTable = cellSel || isInTable(state);

  if (!inTable) {
    return {
      inTable: false,
      multiCell: false,
      mergedCell: false,
      headerRow: false,
      bg: null,
      textColor: null,
    };
  }

  let cellCount = 0;
  if (cellSel) {
    sel.forEachCell(() => {
      cellCount += 1;
    });
  }

  const rect = selectedRect(state);
  const $cell = selectionCell(state);
  const attrs = ($cell?.nodeAfter?.attrs ?? {}) as Record<string, unknown>;

  return {
    inTable: true,
    multiCell: cellCount > 1,
    mergedCell: Number(attrs.colspan ?? 1) > 1 || Number(attrs.rowspan ?? 1) > 1,
    headerRow: rowIsHeader(rect.map, rect.table, 0),
    bg: typeof attrs.backgroundColor === 'string' ? attrs.backgroundColor : null,
    textColor: typeof attrs.dataColor === 'string' ? attrs.dataColor : null,
  };
}

/**
 * "Cell fill" palette — same colors as in the prototype.
 * We store a semi-transparent fill (rgba) from the design in the PM backgroundColor attribute,
 * so the cell looks like the mockup rather than a solid color.
 */
export const TABLE_FILLS: Array<{
  id: string;
  label: string;
  css: string;
  /** Palette key (hex) — for determining the active swatch. */
  color: string | null;
}> = [
  { id: 'none', label: 'No fill', css: 'none', color: null },
  { id: 'violet', label: 'Purple fill', css: 'violet', color: '#b3a3f7' },
  { id: 'green', label: 'Green fill', css: 'green', color: '#4ade80' },
  { id: 'yellow', label: 'Yellow fill', css: 'yellow', color: '#f59e0b' },
  { id: 'red', label: 'Red fill', css: 'red', color: '#f87171' },
];

/** Palette hex → semi-transparent fill from the prototype. */
export const TABLE_BG_RGBA: Record<string, string> = {
  '#b3a3f7': 'rgba(179, 163, 247, .16)',
  '#4ade80': 'rgba(74, 222, 128, .14)',
  '#f59e0b': 'rgba(245, 158, 11, .15)',
  '#f87171': 'rgba(248, 113, 113, .14)',
};

/** Value of the backgroundColor attribute for the selected palette hex. */
export function bgHexToAttr(hex: string | null): string | null {
  if (hex == null) {
    return null;
  }
  return TABLE_BG_RGBA[hex] ?? hex;
}
