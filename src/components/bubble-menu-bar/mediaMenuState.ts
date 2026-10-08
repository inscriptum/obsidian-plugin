import type { Node as ProseMirrorNode } from "prosemirror-model";
import type { EditorState } from "prosemirror-state";
import { NodeSelection } from "prosemirror-state";

export type MediaNodeType = "image" | "attachment" | "mermaid";

export interface MediaMenuState {
  nodeType: MediaNodeType | null;
  filename: string;
  hasFile: boolean;
  /** Current layout (image/mermaid nodes, null otherwise). */
  align: string | null;
}

export interface SelectedMedia {
  node: ProseMirrorNode;
  pos: number;
}

/** The selected node + position if it is an image/attachment/mermaid, else null. */
export function getSelectedMediaNode(state: EditorState): SelectedMedia | null {
  const sel = state.selection;
  if (!(sel instanceof NodeSelection)) return null;
  const name = sel.node.type.name;
  if (name !== "image" && name !== "attachment" && name !== "mermaid") {
    return null;
  }
  return { node: sel.node, pos: sel.from };
}

/** True when the current selection is an image/attachment/mermaid node. */
export function isMediaNodeSelection(state: EditorState): boolean {
  return getSelectedMediaNode(state) != null;
}

/** Display state for the media bubble menu (filename, hasFile, align). */
export function getMediaMenuState(state: EditorState): MediaMenuState {
  const sel = getSelectedMediaNode(state);
  if (!sel) {
    return { nodeType: null, filename: "", hasFile: false, align: null };
  }
  const attrs = sel.node.attrs as {
    data?: { id?: string; filename?: string } | null;
    align?: string | null;
  };
  const id = typeof attrs.data?.id === "string" ? attrs.data.id : "";
  const filename =
    typeof attrs.data?.filename === "string" ? attrs.data.filename : "";
  const alignable = sel.node.type.name !== "attachment";
  return {
    nodeType: sel.node.type.name as MediaNodeType,
    filename: filename || id,
    hasFile: id !== "",
    align: alignable ? (attrs.align ?? "left") : null,
  };
}
