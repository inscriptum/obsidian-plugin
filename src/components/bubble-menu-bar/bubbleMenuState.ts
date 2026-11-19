import type { EditorState } from "prosemirror-state";
import type { Editor } from "../../texto/core";
import { BORDER_COLORS } from "./tableMenuState";

export interface BubbleMenuState {
  /** Inline marks */
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  code: boolean;
  mark: boolean;
  link: boolean;
  /** Blocks */
  paragraph: boolean;
  h1: boolean;
  h2: boolean;
  h3: boolean;
  quote: boolean;
  list: boolean;
  taskList: boolean;
  /** Horizontal alignment of the current text block (issues/text-align):
   *  left is the absence of the attrs.align attribute. */
  align: "left" | "center" | "right";
  /** Text color (textStyle.color attribute) */
  color: string | null;
}

export interface TextColorSwatch {
  id: string;
  label: string;
  /** CSS class suffix bb-sw--<css> */
  css: string;
  color: string | null;
}

/** "Text color" palette — unified with the borders/fill picker (the extended
 *  11-color palette); "Default color" resets. The Aa layers in both bubbles
 *  also carry a custom color row (native picker + hex) below this grid. */
export const TEXT_COLORS: TextColorSwatch[] = [
  { id: "none", label: "Default color", css: "none", color: null },
  ...BORDER_COLORS.filter((c) => c.color != null),
];

/** "Highlight" palette — six translucent swatches, one per gamma of
 *  Obsidian's highlight palette. Colors ride in the mark attrs (texto
 *  does not know palettes), so the reverse mapping for the active
 *  swatch is by string; there is no "default" entry. */
export const HIGHLIGHT_COLORS: Array<TextColorSwatch & { color: string }> = [
  { id: "yellow", label: "Yellow highlight", css: "yellow", color: "rgba(224, 172, 0, 0.3)" },
  { id: "orange", label: "Orange highlight", css: "orange", color: "rgba(236, 117, 0, 0.3)" },
  { id: "green", label: "Green highlight", css: "green", color: "rgba(8, 185, 78, 0.3)" },
  { id: "blue", label: "Blue highlight", css: "blue", color: "rgba(8, 109, 221, 0.3)" },
  { id: "purple", label: "Purple highlight", css: "purple", color: "rgba(120, 82, 238, 0.3)" },
  { id: "red", label: "Red highlight", css: "red", color: "rgba(233, 49, 71, 0.3)" },
];

const HIGHLIGHT_COLOR_KEY = "inscriptum:last-highlight-color";
let lastHighlightColor: string | null = null;

/** The default is represented by a colorless mark; ignore stale storage values. */
export function getLastHighlightColor(): string | null {
  try {
    const stored = window.localStorage.getItem(HIGHLIGHT_COLOR_KEY);
    return HIGHLIGHT_COLORS.some((sw) => sw.color === stored) ? stored : lastHighlightColor;
  } catch {
    return lastHighlightColor;
  }
}

export function setLastHighlightColor(color: string | null): void {
  lastHighlightColor = color;
  try {
    if (color === null) window.localStorage.removeItem(HIGHLIGHT_COLOR_KEY);
    else window.localStorage.setItem(HIGHLIGHT_COLOR_KEY, color);
  } catch {
    // Storage can be unavailable in embedded contexts; keep the session value.
  }
}

/**
 * Active state of bubble menu buttons based on the current editor selection.
 * Pure function of editor.isActive / editor.getAttributes — easy to test.
 */
export function getBubbleMenuState(
  editor: Pick<Editor, "isActive" | "getAttributes">,
): BubbleMenuState {
  const textStyle = editor.getAttributes("textStyle");
  // The current text block is a paragraph or a heading (lists and cells hold
  // paragraphs); whichever type is active carries the attrs.align value.
  const blockAttrs = editor.isActive("heading")
    ? editor.getAttributes("heading")
    : editor.getAttributes("paragraph");
  const rawAlign =
    typeof blockAttrs?.align === "string" ? blockAttrs.align : null;
  const align: BubbleMenuState["align"] =
    rawAlign === "center" || rawAlign === "right" ? rawAlign : "left";

  return {
    bold: editor.isActive("bold"),
    italic: editor.isActive("italic"),
    underline: editor.isActive("underline"),
    strike: editor.isActive("strike"),
    code: editor.isActive("code"),
    mark: editor.isActive("highlight"),
    link: editor.isActive("link"),
    paragraph: editor.isActive("paragraph"),
    h1: editor.isActive("heading", { level: 1 }),
    h2: editor.isActive("heading", { level: 2 }),
    h3: editor.isActive("heading", { level: 3 }),
    quote: editor.isActive("blockquote"),
    list: editor.isActive("bulletList") || editor.isActive("orderedList"),
    taskList: editor.isActive("taskList"),
    align,
    color: typeof textStyle?.color === "string" ? textStyle.color : null,
  };
}

/** Mark presence across the whole selection: "all" — every text node carries
 *  the mark, "none" — none does, "mixed" — the selection straddles the mark
 *  boundary. */
export type MarkSpread = "all" | "none" | "mixed";

export interface SelectionMarkSpreads {
  bold: MarkSpread;
  italic: MarkSpread;
  underline: MarkSpread;
  strike: MarkSpread;
  code: MarkSpread;
  mark: MarkSpread;
  link: MarkSpread;
  /** Single text color of the selection; null when absent or MIXED. */
  color: string | null;
  /** True when the selection holds several distinct text colors. */
  colorMixed: boolean;
  /** Single highlight color across the selection — only when the mark
   *  covers it fully AND carries one color (null for the theme default).
   *  Any mix of colors or an uncovered gap yields null, so the active
   *  highlight swatch clears only what a tap would clear wholesale. */
  markColor: string | null;
}

const SPREAD_MARKS: Array<{
  name: string;
  key: keyof Omit<SelectionMarkSpreads, "color" | "colorMixed" | "markColor">;
}> = [
  { name: "bold", key: "bold" },
  { name: "italic", key: "italic" },
  { name: "underline", key: "underline" },
  { name: "strike", key: "strike" },
  { name: "code", key: "code" },
  { name: "highlight", key: "mark" },
  { name: "link", key: "link" },
];

/**
 * Per-mark presence across the current selection — pure function of
 * EditorState, so a partly formatted selection is distinguishable from a
 * fully formatted one (consumers can report the tri-state, e.g. via
 * aria-pressed on a toggle button). An empty selection reports the stored
 * marks at the caret (state.storedMarks, falling back to $from.marks()) —
 * the same marks getBubbleMenuState sees via isActive.
 *
 * Coverage follows the toggle decision rule (isMarkActive): text where the
 * mark CANNOT apply — an existing mark excludes it, e.g. inline code
 * (excludes: "_") — counts as covered, not uncovered, so the displayed
 * state always predicts what a toggle will do.
 */
export function getSelectionMarkSpreads(
  state: EditorState,
): SelectionMarkSpreads {
  const counters = new Map<string, { has: boolean; hasNot: boolean }>();
  for (const { name } of SPREAD_MARKS)
    counters.set(name, { has: false, hasNot: false });
  const colors = new Set<string | null>();
  const markColors = new Set<string | null>();
  const { from, to, empty, $from } = state.selection;

  if (empty) {
    // Parity with isMarkActive: typed-ahead marks at the caret count in.
    const marks = state.storedMarks ?? $from.marks();
    for (const { name } of SPREAD_MARKS) {
      const c = counters.get(name)!;
      const type = state.schema.marks[name];
      if (type && type.isInSet(marks)) c.has = true;
      else c.hasNot = true;
    }
    const textStyle = marks.find((m) => m.type.name === "textStyle");
    colors.add(
      typeof textStyle?.attrs.color === "string" ? textStyle.attrs.color : null,
    );
    const highlight = marks.find((m) => m.type.name === "highlight");
    markColors.add(
      typeof highlight?.attrs.color === "string"
        ? highlight.attrs.color
        : null,
    );
  } else {
    // Exact parity with isMarkActive's toggle-decision arithmetic: text
    // where the mark cannot apply (an existing mark excludes it, e.g.
    // inline code with excludes: "_") counts as covered, not uncovered, so
    // the displayed state always predicts what a toggle will do.
    let selectionRange = 0;
    const matched = new Map<string, number>();
    const excluded = new Map<string, number>();
    for (const { name } of SPREAD_MARKS) {
      matched.set(name, 0);
      excluded.set(name, 0);
    }
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (!node.isText && !node.marks.length) return;
      const relFrom = Math.max(from, pos);
      const relTo = Math.min(to, pos + node.nodeSize);
      const range = relTo - relFrom;
      selectionRange += range;
      for (const { name } of SPREAD_MARKS) {
        const type = state.schema.marks[name];
        if (!type) continue;
        if (type.isInSet(node.marks))
          matched.set(name, matched.get(name)! + range);
        else if (node.marks.some((mark) => mark.type.excludes(type)))
          excluded.set(name, excluded.get(name)! + range);
      }
      const textStyle = node.marks.find((m) => m.type.name === "textStyle");
      colors.add(
        typeof textStyle?.attrs.color === "string"
          ? textStyle.attrs.color
          : null,
      );
      const highlight = node.marks.find((m) => m.type.name === "highlight");
      markColors.add(
        typeof highlight?.attrs.color === "string"
          ? highlight.attrs.color
          : null,
      );
      return true;
    });
    for (const { name } of SPREAD_MARKS) {
      const c = counters.get(name)!;
      const m = matched.get(name)!;
      const e = excluded.get(name)!;
      if (m > 0 && m + e >= selectionRange) c.has = true;
      else if (m > 0) {
        c.has = true;
        c.hasNot = true;
      }
      // matched === 0: nothing carries the mark — stays "none" (a toggle
      // cannot touch excluded-only text either).
    }
  }

  const spread = (name: string): MarkSpread => {
    const c = counters.get(name)!;
    if (c.has && c.hasNot) return "mixed";
    return c.has ? "all" : "none";
  };
  const singleColor = colors.size === 1 ? [...colors][0]! : null;
  const singleMarkColor = markColors.size === 1 ? [...markColors][0]! : null;
  return {
    bold: spread("bold"),
    italic: spread("italic"),
    underline: spread("underline"),
    strike: spread("strike"),
    code: spread("code"),
    mark: spread("highlight"),
    link: spread("link"),
    color: singleColor,
    colorMixed: colors.size > 1,
    markColor: singleMarkColor,
  };
}
