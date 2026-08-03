import type { Editor } from "../../texto/core";

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

/** "Text color" palette — same as in the bubble-menu-prototype.html prototype. */
export const TEXT_COLORS: TextColorSwatch[] = [
  { id: "none", label: "Default color", css: "none", color: null },
  { id: "violet", label: "Purple", css: "violet", color: "#b3a3f7" },
  { id: "green", label: "Green", css: "green", color: "#4ade80" },
  { id: "yellow", label: "Yellow", css: "yellow", color: "#f59e0b" },
  { id: "red", label: "Red", css: "red", color: "#f87171" },
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
