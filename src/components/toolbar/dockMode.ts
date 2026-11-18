import { Editor, isTextSelection } from "../../texto/core";
import { CellSelection, isInTable } from "prosemirror-tables";
import { isMediaNodeSelection } from "../bubble-menu-bar/mediaMenuState";
import { selectionInCodeBlock } from "../../texto/extensions/code-block-hljs";

export type DockMode = "none" | "text" | "table" | "media";

/**
 * Which context menu the bottom dock should show for the current editor
 * state. Pure function of the editor state — shared by the note toolbar
 * (desktop table dock decision + legacy mobile path) and the mobile menu
 * dock, so the two can never disagree about the active context.
 */
export function computeDockMode(editor: Editor): DockMode {
  const { selection } = editor.state;
  if (isMediaNodeSelection(editor.state)) return "media";
  if (isInTable(editor.state)) {
    if (selection.empty || selection instanceof CellSelection) return "table";
  }
  // Code blocks accept no marks — no selection bar inside one (a selection
  // crossing the block boundary keeps the bar for the surrounding text).
  if (
    !selection.empty &&
    isTextSelection(selection) &&
    !selectionInCodeBlock(editor.state)
  )
    return "text";
  return "none";
}
