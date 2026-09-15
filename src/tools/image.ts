import type { App, TFile } from "obsidian";
import type { Node as ProseMirrorNode } from "prosemirror-model";
import type { Editor } from "../texto/core";
import type {
  ImageElementPublicProps,
  ImageOptionsAttrs,
  UpdateFn,
} from "../texto/extensions/image";
import { findPosByKey } from "../texto/extensions/state";
import { openImageLightbox } from "../ui/imageLightbox";
import { saveAttachmentFile } from "../storage/attachments";

export interface ImageToolContext {
  app: App;
  noteFile: TFile;
}

/**
 * Handles a file inserted via paste/drop for a new image node.
 * Called from the State.onAdd hook — once when the node is created.
 */
export function handleAddImg(
  attrs: ImageOptionsAttrs,
  editorRef: { current: Editor | null },
  ctx: ImageToolContext,
): void {
  window.requestAnimationFrame(() => {
    const editor = editorRef.current;
    if (editor == null) return;
    // Already saved or no file to process
    if (attrs.data?.id != null) return;
    const file = attrs.state?.preparedData?.file;
    if (file == null) return;

    void onFileSelected(
      file,
      (updatedAttrs) => {
        const pos = findPosByKey(editor.state, attrs.key);
        if (pos != null) {
          editor.view.dispatch(
            editor.state.tr
              .setNodeMarkup(pos, editor.schema.nodes.image, {
                ...updatedAttrs,
                key: attrs.key,
              })
              .setMeta("addToHistory", false),
          );
        }
      },
      ctx,
    );
  });
}

/**
 * Saves a file next to the note and sets src/id.
 */
async function onFileSelected(
  file: File,
  update: UpdateFn,
  ctx: ImageToolContext,
): Promise<void> {
  update({
    state: { text: "Loading…", subtext: "", preparedData: undefined },
    data: undefined,
  });
  try {
    const saved = await saveAttachmentFile(ctx.app, ctx.noteFile, file);
    update({
      state: { src: saved.src, text: "", subtext: "", preparedData: undefined },
      data: { id: saved.id, size: saved.size, filename: saved.filename },
    });
  } catch (err) {
    update({ state: { error: String(err), preparedData: undefined } });
  }
}

/**
 * Checks whether any image node in the document (other than the one with
 * `excludeKey`) references the same attachment `id`. Used to avoid deleting
 * a file that is still referenced by a duplicate of the node (copy/paste,
 * key reassignments, etc.).
 */
export function isImageIdReferenced(
  doc: ProseMirrorNode,
  id: string,
  excludeKey?: string | null,
): boolean {
  let found = false;

  doc.descendants((node) => {
    if (found) return false;
    if (node.type.name !== "image") return true;

    const data = node.attrs.data as { id?: string } | undefined;
    if (data?.id !== id) return true;
    if (excludeKey != null && node.attrs.key === excludeKey) return true;

    found = true;

    return false;
  });

  return found;
}

/**
 * onSetViewProps hook for Image:
 *  - re-resolves src from data.id on every load (the stored `app://…` resource
 *    URL embeds a vault hash that can go stale between launches);
 *  - clears a persisted error state when the file is available again, so a
 *    restored/renamed attachment starts loading (error blocks are sticky
 *    otherwise);
 *  - shows an informative error when the file is missing from the vault;
 *  - injects onClick to open a fullscreen lightbox (zoom) for an available
 *    image;
 *  - injects onFileSelected for file selection via input.
 */
export function imageOnSetViewProps(
  props: ImageElementPublicProps,
  update: UpdateFn,
  ctx: ImageToolContext,
): ImageElementPublicProps | undefined {
  let state = props.state;

  if (props.data?.id != null) {
    const fileExists =
      ctx.app.vault.getAbstractFileByPath(props.data.id) != null;

    if (!fileExists) {
      const error = `File not found: ${props.data.filename || props.data.id}`;
      if (state?.error !== error || state?.src != null) {
        state = { ...state, src: undefined, error };
        update({ data: props.data, state }, true);
      }

      return {
        ...props,
        state,
        onFileSelected: (file: File | null) => {
          if (file) void onFileSelected(file, update, ctx);
        },
      };
    }

    const src = ctx.app.vault.adapter.getResourcePath(props.data.id);
    if (state?.src !== src) {
      state = { ...state, src, error: undefined };
      update({ data: props.data, state }, true);
    }

    const imageId: string = props.data.id;

    return {
      ...props,
      state,
      onClick: (event: MouseEvent) => {
        event.stopPropagation();
        openImageLightbox(ctx.app, imageId, props.data.filename);
      },
      onFileSelected: (file: File | null) => {
        if (file) void onFileSelected(file, update, ctx);
      },
    };
  }

  return {
    ...props,
    state,
    onFileSelected: (file: File | null) => {
      if (file) void onFileSelected(file, update, ctx);
    },
  };
}
