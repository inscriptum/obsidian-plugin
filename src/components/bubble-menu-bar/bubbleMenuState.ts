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
    color: typeof textStyle?.color === "string" ? textStyle.color : null,
  };
}
