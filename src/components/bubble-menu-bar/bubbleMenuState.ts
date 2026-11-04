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
