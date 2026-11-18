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
}

const SPREAD_MARKS: Array<{
  name: string;
  key: keyof Omit<SelectionMarkSpreads, "color" | "colorMixed">;
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
 */
export function getSelectionMarkSpreads(
  state: EditorState,
): SelectionMarkSpreads {
  const counters = new Map<string, { has: boolean; hasNot: boolean }>();
  for (const { name } of SPREAD_MARKS)
    counters.set(name, { has: false, hasNot: false });
  const colors = new Set<string | null>();
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
  } else {
    state.doc.nodesBetween(from, to, (node) => {
      if (!node.isText) return true;
      for (const { name } of SPREAD_MARKS) {
        const c = counters.get(name)!;
        const type = state.schema.marks[name];
        if (type && type.isInSet(node.marks)) c.has = true;
        else c.hasNot = true;
      }
      const textStyle = node.marks.find((m) => m.type.name === "textStyle");
      colors.add(
        typeof textStyle?.attrs.color === "string"
          ? textStyle.attrs.color
          : null,
      );
      return true;
    });
  }

  const spread = (name: string): MarkSpread => {
    const c = counters.get(name)!;
    if (c.has && c.hasNot) return "mixed";
    return c.has ? "all" : "none";
  };
  const singleColor = colors.size === 1 ? [...colors][0]! : null;
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
  };
}
