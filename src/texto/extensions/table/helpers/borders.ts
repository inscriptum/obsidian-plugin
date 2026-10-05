/* Cell/table border model — the web counterpart of the MS Word "Borders"
   feature. A cell stores its border per side in the `borders` attribute;
   a table stores `borders: "none"` to suppress the default CSS grid.
   Collisions between adjacent cells are resolved by border-collapse
   (the wider border wins) — the same rule Word applies. */

export type BorderSideName = "top" | "right" | "bottom" | "left";

/** Only styles with a direct CSS equivalent are offered (the exotic Word
   styles — wave, triple, thick-thin… — have none and are not emulated). */
export type BorderStyleName = "solid" | "double" | "dotted" | "dashed" | "none";

/** One side as stored in the `borders` attribute of tableCell/tableHeader. */
export interface CellBorderSide {
  style: BorderStyleName;
  /** CSS length, e.g. "1.5pt". Only meaningful for a visible style. */
  width?: string;
  /** CSS color; null = theme default (resolves via --inscriptum-table-border). */
  color?: string | null;
}

/** Value of the `borders` attribute: sides explicitly set by the user.
   Absent side = plugin default grid (CSS). null attribute = untouched cell. */
export type CellBorders = Partial<Record<BorderSideName, CellBorderSide>>;

/** "Pen" — the parameters the UI applies to sides/presets. */
export interface BorderPen {
  style: Exclude<BorderStyleName, "none">;
  width: string;
  color: string | null;
}

export const BORDER_SIDES: BorderSideName[] = [
  "top",
  "right",
  "bottom",
  "left",
];

/** Auto color renders via the variable so one attr value works in both themes. */
export const BORDER_AUTO_COLOR = "var(--inscriptum-table-border)";

/** `borders` attr of the table node — currently only "none" (suppresses the
   default grid for the whole table, including freshly inserted cells). */
export type TableBorders = "none" | null;

export function penToSide(pen: BorderPen): CellBorderSide {
  return { style: pen.style, width: pen.width, color: pen.color ?? null };
}

/** Same pen already applied to a side? Used by the side-button toggle. */
export function sideMatchesPen(
  side: CellBorderSide | undefined,
  pen: BorderPen,
): boolean {
  if (!side) return false;
  return (
    side.style === pen.style &&
    (side.width ?? "1pt") === pen.width &&
    (side.color ?? null) === (pen.color ?? null)
  );
}

/** Stored attrs come from files verbatim and are not schema-validated —
   only UI-shaped values may reach the inline style (a crafted width/color
   could inject CSS declarations). */
const SAFE_BORDER_WIDTH = /^[0-9.]+(?:pt|px|em|rem|%)?$/i;
const SAFE_BORDER_STYLE = /^(?:solid|double|dotted|dashed|none)$/i;

function safeBorderColor(color: string): string | null {
  if (color === BORDER_AUTO_COLOR) return color;
  // Hex, numeric rgb()/rgba() or a bare named color — nothing that could
  // carry declarations or url() tokens.
  return /^[a-z]+$|^#(?:[0-9a-f]{3}|[0-9a-f]{6})$|^rgba?\([0-9.,\s]+\)$/i.test(
    color.trim(),
  )
    ? color.trim()
    : null;
}

/** Inline style for the cell's `borders` attribute; "" when nothing to draw.
   !important is required to beat the stylesheet's default
   `td/th { border: 1px solid … !important }` (see style.css).
   Sides with malformed values are skipped — an untrusted attribute must
   not reach the style. */
export function bordersToStyle(
  borders: CellBorders | null | undefined,
): string {
  if (!borders) return "";
  const parts: string[] = [];
  for (const side of BORDER_SIDES) {
    const spec = borders[side];
    if (!spec) continue;
    if (spec.style === "none") {
      parts.push(`border-${side}: none !important`);
    } else {
      const width = spec.width ?? "1pt";
      const color = safeBorderColor(spec.color || BORDER_AUTO_COLOR);
      if (
        !SAFE_BORDER_STYLE.test(spec.style) ||
        !SAFE_BORDER_WIDTH.test(width) ||
        !color
      ) {
        continue;
      }
      parts.push(`border-${side}: ${width} ${spec.style} ${color} !important`);
    }
  }
  return parts.join("; ");
}

/** rgb()/rgba() from parsed inline styles → hex, so palette swatches match. */
function normalizeColor(raw: string): string | null {
  const value = raw.trim();
  const rgb = value.match(
    /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/i,
  );
  if (!rgb) return value || null;
  const [, r, g, b] = rgb;
  const hex = (n: string) =>
    Number(n).toString(16).padStart(2, "0").toUpperCase();
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

const KNOWN_STYLES: ReadonlySet<string> = new Set([
  "solid",
  "double",
  "dotted",
  "dashed",
]);

/** Read the `borders` attribute back from inline styles (paste round-trip).
   Exotic pasted styles are dropped — the side falls back to the default grid. */
export function bordersFromStyle(element: HTMLElement): CellBorders | null {
  const style = element.style;
  const borders: CellBorders = {};
  let found = false;
  for (const side of BORDER_SIDES) {
    const styleName = style.getPropertyValue(`border-${side}-style`).trim();
    if (!styleName) continue;
    found = true;
    if (styleName === "none" || styleName === "hidden") {
      borders[side] = { style: "none" };
      continue;
    }
    if (!KNOWN_STYLES.has(styleName)) continue;
    const width = style.getPropertyValue(`border-${side}-width`).trim();
    const color = normalizeColor(
      style.getPropertyValue(`border-${side}-color`),
    );
    borders[side] = {
      style: styleName as Exclude<BorderStyleName, "none">,
      width: width || "1pt",
      color,
    };
  }
  return found ? borders : null;
}
