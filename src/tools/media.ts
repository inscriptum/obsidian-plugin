import type { App } from "obsidian";
import type { Node as ProseMirrorNode } from "prosemirror-model";
import type { Editor } from "../texto/core";
import { getSelectedMediaNode } from "../components/bubble-menu-bar/mediaMenuState";
import { nodeStatePluginKey } from "../texto/extensions/state";
import type { ImageLayout } from "../texto/extensions/image/image";
import { openAttachmentFile } from "./attachment";

/** Open the selected media file with the OS default app. */
export function openMediaFile(app: App, node: ProseMirrorNode): void {
  openAttachmentFile(
    app,
    node.attrs.data as { id?: string | null; mode?: string | null } | null,
  );
}

/** Re-open the OS file picker for the selected media node (replace flow). */
export function replaceMediaFile(editor: Editor): void {
  const sel = getSelectedMediaNode(editor.state);
  if (!sel) return;
  const attrs = sel.node.attrs as Record<string, unknown>;
  const nodeState = (attrs.state ?? {}) as Record<string, unknown>;
  editor.view.dispatch(
    editor.state.tr
      .setNodeMarkup(sel.pos, sel.node.type, {
        ...attrs,
        state: { ...nodeState, isAutoOpenFileSelection: true },
      })
      .setMeta("addToHistory", false),
  );
}

/** Set the layout (align/wrap) of the selected image node.
    "full" always resets the explicit user width — full-bleed wins. */
export function setImageNodeLayout(editor: Editor, align: ImageLayout): void {
  const sel = getSelectedMediaNode(editor.state);
  if (!sel || sel.node.type.name !== "image") return;

  editor.view.dispatch(
    editor.state.tr.setNodeMarkup(sel.pos, sel.node.type, {
      ...(sel.node.attrs as Record<string, unknown>),
      align,
      width:
        align === "full"
          ? null
          : (sel.node.attrs as Record<string, unknown>).width,
    }),
  );
}

/** Set the layout (align/wrap) of the selected mermaid node (no explicit
    width interplay — a diagram has no user width attr). */
export function setMermaidNodeLayout(editor: Editor, align: string): void {
  const sel = getSelectedMediaNode(editor.state);
  if (!sel || sel.node.type.name !== "mermaid") return;

  editor.view.dispatch(
    editor.state.tr.setNodeMarkup(sel.pos, sel.node.type, {
      ...(sel.node.attrs as Record<string, unknown>),
      align,
    }),
  );
}

/** Ask the selected mermaid node's view to open its inline source editor.
    The NodeView listens for this DOM event on its host element. */
export function editMermaidDiagram(editor: Editor): void {
  const sel = getSelectedMediaNode(editor.state);
  if (!sel || sel.node.type.name !== "mermaid") return;
  const dom = editor.view.nodeDOM(sel.pos) as HTMLElement | null;
  dom?.dispatchEvent(new CustomEvent("texto-mermaid-edit"));
}

/** Remove the selected media node; image file cleanup goes through the
    State plugin (meta). An attachment node is a link — deleting it never
    touches the file (in vault or external). A mermaid diagram has no
    file — plain delete. */
export function removeMediaNode(editor: Editor): void {
  const sel = getSelectedMediaNode(editor.state);
  if (!sel) return;
  const { node, pos } = sel;
  const to = pos + node.nodeSize;

  if (node.type.name === "image") {
    const action = {
      remove: {
        id: node.attrs.key as string,
        transactionsMeta: { isChangeOrigin: false, isSilent: true },
      },
    };
    editor.view.dispatch(
      editor.state.tr
        .deleteRange(pos, to)
        .setMeta(nodeStatePluginKey, action)
        .setMeta("addToHistory", false),
    );
  } else if (node.type.name === "mermaid") {
    // No file to clean up — a plain delete that stays in undo history,
    // so a deleted diagram is restorable with Undo.
    editor.view.dispatch(editor.state.tr.deleteRange(pos, to));
  } else {
    // Attachment: unlink only — the linked file (vault or external) is
    // never deleted; an in-vault copy left behind is an accepted orphan.
    editor.view.dispatch(
      editor.state.tr.deleteRange(pos, to).setMeta("addToHistory", false),
    );
  }
}
