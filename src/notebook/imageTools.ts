import type { Editor } from "../texto/core";
import type {
  ImageElementPublicProps,
  ImageOptionsAttrs,
  UpdateFn,
} from "../texto/extensions/image";
import type { ImageToolContext } from "../tools/image";
import { findPosByKey } from "../texto/extensions/state";
import { openImageLightboxFromUrl } from "../ui/imageLightbox";
import { imageOnSetViewProps } from "../tools/image";
import type { UmNotebook } from "../storage/um/umNotebook";

/**
 * Container variants of the image tools (src/tools/image.ts): image bytes
 * live inside the `.um` archive and image nodes reference them by asset id
 * (spec section 17). Notes can still carry external vault images — any
 * `data.id` that is not a container asset id falls back to the standard
 * vault resolution (the notebook file itself anchors external attachments,
 * same as a plain note).
 */

async function packImage(
  file: File,
  notebook: UmNotebook,
  apply: (attrs: Partial<ImageOptionsAttrs>) => void,
): Promise<void> {
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const asset = notebook.addAsset(bytes, file.name, file.type);
    const url = notebook.assetUrl(asset.id);
    apply({
      state: {
        src: url ?? undefined,
        text: "",
        subtext: "",
        preparedData: undefined,
      },
      data: {
        id: asset.id,
        size: String(asset.size ?? bytes.byteLength),
        filename: file.name,
      },
    });
  } catch (err) {
    apply({ state: { error: String(err), preparedData: undefined } });
  }
}

/** Handles a file inserted via paste/drop for a new image node: packs the
 *  bytes into the notebook and rewrites the node with the asset reference. */
export function handleAddImgContainer(
  attrs: ImageOptionsAttrs,
  editorRef: { current: Editor | null },
  notebook: UmNotebook,
): void {
  window.requestAnimationFrame(() => {
    const editor = editorRef.current;
    if (editor == null) return;
    // Already saved or no file to process
    if (attrs.data?.id != null) return;
    const file = attrs.state?.preparedData?.file;
    if (file == null) return;

    void packImage(file, notebook, (updatedAttrs) => {
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
    });
  });
}

/** onSetViewProps hook for Image inside a notebook:
 *  - asset ids resolve to cached object URLs from the container;
 *  - missing assets show an error (broken image, never a broken notebook);
 *  - everything else is an external vault image and uses the standard
 *    vault resolution (src/tools/image.ts);
 *  - zoom opens the lightbox from the resolved URL. */
export function imageOnSetViewPropsContainer(
  props: ImageElementPublicProps,
  update: UpdateFn,
  ctx: ImageToolContext,
  notebook: UmNotebook,
): ImageElementPublicProps | undefined {
  const data = props.data as { id?: string; filename?: string | null } | null;
  const id = data?.id;

  if (id != null && notebook.isAssetId(id)) {
    let state = props.state;
    const url = notebook.assetUrl(id);
    if (url == null) {
      const error = `Asset not found in notebook: ${data?.filename || id}`;
      if (state?.error !== error || state?.src != null) {
        state = { ...state, src: undefined, error };
        update({ data: props.data, state }, true);
      }
    } else if (state?.src !== url || state?.error != null) {
      state = { ...state, src: url, error: undefined };
      update({ data: props.data, state }, true);
    }

    return {
      ...props,
      state,
      onClick: (event: MouseEvent) => {
        event.stopPropagation();
        if (url != null) openImageLightboxFromUrl(url, data?.filename);
      },
      onFileSelected: (file: File | null) => {
        if (file)
          void packImage(file, notebook, (updatedAttrs) =>
            update(updatedAttrs),
          );
      },
    };
  }

  // External vault image — standard resolution anchored at the notebook file.
  return imageOnSetViewProps(props, update, ctx);
}
