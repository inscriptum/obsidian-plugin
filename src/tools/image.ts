import type { App, TFile } from 'obsidian';
import type { Editor } from '../texto/core';
import type {
  ImageElementPublicProps,
  ImageOptionsAttrs,
  UpdateFn,
} from '../texto/extensions/image';
import { findPosByKey } from '../texto/extensions/state';
import { saveAttachmentFile } from '../storage/attachments';

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
  requestAnimationFrame(() => {
    const editor = editorRef.current;
    if (editor == null) return;
    // Already saved or no file to process
    if (attrs.data?.id != null) return;
    const file = attrs.state?.preparedData?.file;
    if (file == null) return;

    void onFileSelected(file, (updatedAttrs) => {
      const pos = findPosByKey(editor.state, attrs.key);
      if (pos != null) {
        editor.view.dispatch(
          editor.state.tr
            .setNodeMarkup(pos, editor.schema.nodes.image, {
              ...updatedAttrs,
              key: attrs.key,
            })
            .setMeta('addToHistory', false),
        );
      }
    }, ctx);
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
  update({ state: { text: 'Loading…', subtext: '', preparedData: undefined }, data: undefined });
  try {
    const saved = await saveAttachmentFile(ctx.app, ctx.noteFile, file);
    update({
      state: { src: saved.src, text: '', subtext: '', preparedData: undefined },
      data: { id: saved.id, size: saved.size, filename: saved.filename },
    });
  } catch (err) {
    update({ state: { error: String(err), preparedData: undefined } });
  }
}

/**
 * onSetViewProps hook for Image:
 *  - restores src from data.id when opening a saved note;
 *  - injects onFileSelected for file selection via input.
 */
export function imageOnSetViewProps(
  props: ImageElementPublicProps,
  update: UpdateFn,
  ctx: ImageToolContext,
): ImageElementPublicProps | undefined {
  // Restore src for an already saved image
  if (props.state?.src == null && props.data?.id != null) {
    const src = ctx.app.vault.adapter.getResourcePath(props.data.id);
    update({ data: props.data, state: { ...props.state, src } }, true);
    return props;
  }

  return {
    ...props,
    onFileSelected: (file: File | null) => {
      if (file) void onFileSelected(file, update, ctx);
    },
  };
}
