import type { EditorState } from "prosemirror-state";
import {
  CellSelection,
  isInTable,
  rowIsHeader,
  selectedRect,
  selectionCell,
} from "prosemirror-tables";
import type { BorderStyleName } from "../../texto/extensions/table/helpers/borders";
import type { BubbleIconName } from "../icons/iconSprite";

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
  /** The current table has the default grid suppressed ("No borders" preset). */
  bordersNone: boolean;
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
      bordersNone: false,
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
  // selectionCell points just before the cell node — node(-1) is the table
  // (same chain prosemirror-tables' selectedRect relies on).
  const tableAttrs = ($cell.node(-1)?.attrs ?? {}) as Record<string, unknown>;

  return {
    inTable: true,
    multiCell: cellCount > 1,
    mergedCell:
      Number(attrs.colspan ?? 1) > 1 || Number(attrs.rowspan ?? 1) > 1,
    headerRow: rowIsHeader(rect.map, rect.table, 0),
    bg:
      typeof attrs.backgroundColor === "string" ? attrs.backgroundColor : null,
    textColor: typeof attrs.dataColor === "string" ? attrs.dataColor : null,
    bordersNone: tableAttrs.borders === "none",
  };
}

/**
 * The design fills of the unified palette store a semi-transparent rgba in
 * the PM backgroundColor attribute, so the cell looks like the mockup
 * rather than a solid color; every other color (extended palette, custom
 * hex) is stored as-is.
 */

/** Palette hex → semi-transparent fill from the prototype. */
export const TABLE_BG_RGBA: Record<string, string> = {
  "#b3a3f7": "rgba(179, 163, 247, .16)",
  "#4ade80": "rgba(74, 222, 128, .14)",
  "#f59e0b": "rgba(245, 158, 11, .15)",
  "#f87171": "rgba(248, 113, 113, .14)",
};

/** Value of the backgroundColor attribute for the selected palette hex. */
export function bgHexToAttr(hex: string | null): string | null {
  if (hex == null) {
    return null;
  }
  return TABLE_BG_RGBA[hex] ?? hex;
}

/* ─── Borders picker data (see helpers/borders.ts for the model) ───────── */

/** Line styles with a direct CSS border-style equivalent. */
export const BORDER_STYLES: Array<{
  id: Exclude<BorderStyleName, "none">;
  label: string;
  icon: BubbleIconName;
}> = [
  { id: "solid", label: "Solid", icon: "bdStyleSolid" },
  { id: "double", label: "Double", icon: "bdStyleDouble" },
  { id: "dotted", label: "Dotted", icon: "bdStyleDotted" },
  { id: "dashed", label: "Dashed", icon: "bdStyleDashed" },
];

/** Word's stroke weights (¼ pt … 6 pt). */
export const BORDER_WIDTHS: Array<{ value: string; label: string }> = [
  { value: "0.25pt", label: "¼ pt" },
  { value: "0.5pt", label: "½ pt" },
  { value: "0.75pt", label: "¾ pt" },
  { value: "1pt", label: "1 pt" },
  { value: "1.5pt", label: "1½ pt" },
  { value: "2.25pt", label: "2¼ pt" },
  { value: "3pt", label: "3 pt" },
  { value: "4.5pt", label: "4½ pt" },
  { value: "6pt", label: "6 pt" },
];

/** Pen colors: "auto" (theme default) + the extended palette; a custom
   picker value (any hex) is stored in the pen as-is. */
export const BORDER_COLORS: Array<{
  id: string;
  label: string;
  css: string;
  color: string | null;
}> = [
  { id: "auto", label: "Auto (theme)", css: "none", color: null },
  { id: "violet", label: "Purple", css: "violet", color: "#b3a3f7" },
  { id: "green", label: "Green", css: "green", color: "#4ade80" },
  { id: "yellow", label: "Yellow", css: "yellow", color: "#f59e0b" },
  { id: "red", label: "Red", css: "red", color: "#f87171" },
  { id: "orange", label: "Orange", css: "orange", color: "#fb923c" },
  { id: "blue", label: "Blue", css: "blue", color: "#60a5fa" },
  { id: "teal", label: "Teal", css: "teal", color: "#2dd4bf" },
  { id: "pink", label: "Pink", css: "pink", color: "#f472b6" },
  { id: "gray", label: "Gray", css: "gray", color: "#94a3b8" },
  { id: "white", label: "White", css: "white", color: "#f1f1f4" },
  { id: "black", label: "Black", css: "black", color: "#2c2c34" },
];

/** Accepts #rgb and #rrggbb — what the hex field and the color picker emit. */
export function isHexColor(value: string): boolean {
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value.trim());
}

/** Value for the native color input of a custom picker row: the current
 *  color expanded to 6-digit hex (the native input rejects #rgb), or the
 *  palette's violet as a neutral fallback when the current color is not a
 *  hex at all (null / theme default). */
export function pickerHexValue(color: string | null): string {
  const six = /^#([0-9a-f]{6})$/i.exec(color ?? "");
  if (six?.[1]) {
    return `#${six[1]}`;
  }
  const three = /^#([0-9a-f]{3})$/i.exec(color ?? "");
  if (three?.[1]) {
    const [r, g, b] = three[1];
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return "#b3a3f7";
}
