/** "Highlight" palette — six translucent swatches, one per gamma of
 *  Obsidian's highlight palette. Colors ride in the mark attrs (texto
 *  does not know palettes), so the reverse mapping for the active
 *  swatch is by string; there is no "default" entry. */
export const HIGHLIGHT_COLORS: Array<{ id: string; label: string; css: string; color: string }> = [
  { id: "yellow", label: "Yellow highlight", css: "yellow", color: "rgba(224, 172, 0, 0.3)" },
  { id: "orange", label: "Orange highlight", css: "orange", color: "rgba(236, 117, 0, 0.3)" },
  { id: "green", label: "Green highlight", css: "green", color: "rgba(8, 185, 78, 0.3)" },
  { id: "blue", label: "Blue highlight", css: "blue", color: "rgba(8, 109, 221, 0.3)" },
  { id: "purple", label: "Purple highlight", css: "purple", color: "rgba(120, 82, 238, 0.3)" },
  { id: "red", label: "Red highlight", css: "red", color: "rgba(233, 49, 71, 0.3)" },
];

const HIGHLIGHT_COLOR_KEY = "inscriptum:last-highlight-color";
let lastHighlightColor: string | null = null;

export const DEFAULT_HIGHLIGHT_COLOR = HIGHLIGHT_COLORS[0].color;

/** Use the last palette choice, falling back to yellow for new highlights. */
export function getLastHighlightColor(): string {
  try {
    const stored = window.localStorage.getItem(HIGHLIGHT_COLOR_KEY);
    return stored !== null && HIGHLIGHT_COLORS.some((sw) => sw.color === stored)
      ? stored
      : lastHighlightColor ?? DEFAULT_HIGHLIGHT_COLOR;
  } catch {
    return lastHighlightColor ?? DEFAULT_HIGHLIGHT_COLOR;
  }
}

export function setLastHighlightColor(color: string): void {
  lastHighlightColor = color;
  try {
    window.localStorage.setItem(HIGHLIGHT_COLOR_KEY, color);
  } catch {
    // Storage can be unavailable in embedded contexts; keep the session value.
  }
}

