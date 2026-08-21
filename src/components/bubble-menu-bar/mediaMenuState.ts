import type { Node as ProseMirrorNode } from "prosemirror-model";
import type { EditorState } from "prosemirror-state";
import { NodeSelection } from "prosemirror-state";

export type MediaNodeType = "image" | "attachment";

export interface MediaMenuState {
  nodeType: MediaNodeType | null;
  filename: string;
  hasFile: boolean;
}

export interface SelectedMedia {
  node: ProseMirrorNode;
  pos: number;
}

/** The selected node + position if it is an image/attachment, else null. */
export function getSelectedMediaNode(state: EditorState): SelectedMedia | null {
  const sel = state.selection;
  if (!(sel instanceof NodeSelection)) return null;
  const name = sel.node.type.name;
  if (name !== "image" && name !== "attachment") return null;
  return { node: sel.node, pos: sel.from };
}

/** True when the current selection is an image/attachment node. */
export function isMediaNodeSelection(state: EditorState): boolean {
  return getSelectedMediaNode(state) != null;
}

/** Display state for the media bubble menu (filename, hasFile). */
export function getMediaMenuState(state: EditorState): MediaMenuState {
  const sel = getSelectedMediaNode(state);
  if (!sel) {
    return { nodeType: null, filename: "", hasFile: false };
  }
  const data = sel.node.attrs.data as { id?: string; filename?: string } | null | undefined;
  const id = typeof data?.id === "string" ? data.id : "";
  const filename = typeof data?.filename === "string" ? data.filename : "";
  return {
    nodeType: sel.node.type.name as MediaNodeType,
    filename: filename || id,
    hasFile: id !== "",
  };
}
