import { isFunction, mergeAttributes, Node } from "../../core";
import { legacyMediaPath } from "../block-ids";
import { elTag } from "../../../tags";
import {
  type NodeStatePluginAction,
  NodeStateDecorationSpec,
  StateNodeAttrs,
  getTransactionsMetadata,
  nodeStatePluginKey,
} from "../state";
import { InternalDecorationSet } from "../state/helpers/decorations";
import * as browser from "../../utils/browser";
import { getFileExt } from "../../utils/getFileExt";
import type { ElementComponentProps } from "@web-companions/gfc/@types";
import {
  type Transaction,
  NodeSelection,
  Plugin,
  PluginKey,
} from "prosemirror-state";
import { Fragment, Slice } from "prosemirror-model";
import { dropPoint } from "prosemirror-transform";
import type { EditorView } from "prosemirror-view";

import { quickDropFiles } from "../attachment/attachment";

import { addCommands } from "./commands";
import { setViewProps } from "./helpers/setViewProps.helper";
import { createResizeHandles } from "./helpers/resizeHandles";
import { processImageInGecko } from "./plugins/processImageInGecko";
import { imageElement } from "./view/image.element";

export type ViewNodeState = {
  src?: string;
  text?: string;
  subtext?: string;
  preparedData?: {
    file?: File;
  };
  isAutoOpenFileSelection?: boolean;
  error?: string | null;
};

/** Standard image extensions the renderer can display; expands the
 *  "image/*" accept wildcard for files the OS reports without a MIME type
 *  (OS file drags of e.g. .JPG often arrive with an empty type). */
const IMAGE_FILE_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "avif",
  "bmp",
  "ico",
];

/** WHY blacklist, not an allowlist on the whole MIME branch: image files
 *  without a file-name extension must keep the MIME path. This only strips
 *  image/* MIME types Chromium reports but the renderer cannot decode —
 *  they would insert a permanently broken image block; extend as needed. */
const UNRENDERABLE_IMAGE_MIME = new Set([
  "image/tiff",
  "image/heic",
  "image/heif",
]);

function buildAcceptedFileExtensions(accept: string | undefined): Set<string> {
  const set = new Set<string>();
  for (const entry of (accept ?? "")
    .split(",")
    .map((it) => it.toLowerCase().trim())
    .filter(Boolean)) {
    if (entry.endsWith("/*")) {
      if (entry === "image/*") {
        for (const ext of IMAGE_FILE_EXTENSIONS) set.add(`.${ext}`);
      }
      continue;
    }
    set.add(entry.startsWith(".") ? entry : `.${entry}`);
  }
  return set;
}

/** Image classification shared by paste and external drop: by MIME first,
 *  by the accept-list extension when the OS reports no type. Exported for
 *  the classification unit tests. */
export function isImageDropFile(
  file: File,
  acceptedFiles: Set<string>,
): boolean {
  if (UNRENDERABLE_IMAGE_MIME.has(file.type)) return false;
  if (file.type.startsWith("image")) {
    // A named file whose extension the renderer cannot display goes to the
    // attachment path instead of a broken image block; extension-less
    // image files keep the MIME path (getFileExt returns the bare name
    // when there is no dot — the dot is what marks a real extension).
    const ext = getFileExt(file.name);
    if (file.name.includes(".") && !IMAGE_FILE_EXTENSIONS.includes(ext)) {
      return false;
    }
    return true;
  }
  if (file.type === "") return acceptedFiles.has(`.${getFileExt(file.name)}`);
  return false;
}

/** A drop/dragover claims the editor only for a single local FILE:
 *  multi-file drags, directory drags (Chromium delivers a folder as one
 *  MIME-less File — recognized directories must not be imported) and
 *  internal block drags keep the host behavior. */
export function isSingleFileDrag(dataTransfer: DataTransfer | null): boolean {
  if (dataTransfer == null || !dataTransfer.types.includes("Files")) {
    return false;
  }
  if (dataTransfer.files.length !== 1) return false;
  const entry = dataTransfer.items[0]?.webkitGetAsEntry?.();
  if (entry?.isDirectory) return false;
  return true;
}

export type UpdateFn = (
  attrs: Omit<ImageOptionsAttrs, "key">,
  preventUpdate?: boolean,
) => void;

export interface ImageOptionsHooks {
  onSetViewProps?: (
    props: ImageElementPublicProps,
    update: UpdateFn,
  ) => ImageElementPublicProps | undefined;
  onDragStart?: (editorView: EditorView, dragEvent: DragEvent) => void;
}

type HTMLAttributes = "id" | "size" | "filename" | "alt" | "caption" | "meta";
export type ViewNodeData = { [K in HTMLAttributes]?: string | null };

export type ImageOptionsAttrs = {
  key: string;
  state?: ViewNodeState | null;
  data?: ViewNodeData | null;
  align?: ImageLayout | null;
  /** Explicit image width as a percent string, e.g. "63%". */
  width?: string | null;
};

export interface ImageOptions {
  attributes: ImageOptionsAttrs;
  accept: string;
  hooks?: ImageOptionsHooks;
  errorIconId?: string;
}

export const VIEW_TAG = elTag("texto-extension-image");
/** Static tag used in HTML serialization (clipboard/export) — stays version-independent. */
export const HTML_TAG = "texto-extension-image";
export const ImageElement = imageElement(VIEW_TAG);

/** Visual layout of an image block. */
export type ImageLayout =
  | "left" // block, own line, aligned left (default)
  | "center" // block, centered
  | "right" // block, aligned right
  | "full" // block, full content width
  | "wrap-left" // float left, text wraps around
  | "wrap-right"; // float right, text wraps around

export const IMAGE_LAYOUTS: ImageLayout[] = [
  "left",
  "center",
  "right",
  "full",
  "wrap-left",
  "wrap-right",
];

/** Disambiguates quick-drop keys created within the same millisecond. */
let quickDropSeq = 0;

export function isImageLayout(value: unknown): value is ImageLayout {
  return (
    typeof value === "string" && IMAGE_LAYOUTS.includes(value as ImageLayout)
  );
}
export type ImageElementPublicProps = Omit<
  InstanceType<typeof ImageElement>["props"],
  | "key"
  | "onOpenFileSelection"
  | "onRemove"
  | "updateAttrs"
  | keyof ElementComponentProps<unknown>
>;

/**
 * TODO: Works only with extension-state, add validations
 */
export const Image = Node.create<ImageOptions>({
  name: "image",
  group: "noteDoc",
  marks: "",
  defining: true,
  draggable: false,
  selectable: true,
  atom: true,

  addOptions() {
    return {
      attributes: {
        key: "",
      },
      accept: "image/*",
    };
  },

  addAttributes() {
    return {
      key: {
        rendered: false,
        default: null,
      },
      state: {
        default: null,
      },
      align: {
        default: "left",
        parseHTML: (element: HTMLElement) => element.dataset["align"],
        renderHTML: (attributes: ImageOptionsAttrs) => ({
          "data-align": attributes.align,
        }),
      },
      width: {
        default: null,
        parseHTML: (element: HTMLElement) => element.dataset["width"],
        renderHTML: (attributes: ImageOptionsAttrs) => ({
          "data-width": attributes.width,
        }),
      },
      data: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          if (element.tagName === HTML_TAG.toUpperCase()) {
            return {
              // data-src is the media namespace for the vault path — the
              // data-id key belongs to the block-ids attr (the two must not
              // share a DOM attribute). The old data-id is read as a
              // fallback so clipboard HTML written by earlier builds still
              // parses — but a value shaped like a BLOCK ID is rejected: a
              // placeholder image (no data.id) renders its block id as
              // data-id, and parsing that back as a vault path would
              // persist a "File not found" into the note.
              id:
                element.dataset["src"] ??
                legacyMediaPath(element.dataset["id"]),
              size: element.dataset["size"],
              filename: element.dataset["filename"],
              meta: element.dataset["meta"],
            };
          }

          return null;
        },
        renderHTML: (attributes: ImageOptionsAttrs) => ({
          // data-src, not data-id: the data-id DOM key belongs to the
          // block-ids attr (see blockIdAttrs) — media must not squat on it,
          // or the block id never reaches the DOM and the export
          // post-processor reads the vault path as if it were a block id.
          [`data-src`]: attributes.data?.id,
          [`data-size`]: attributes.data?.size,
          [`data-filename`]: attributes.data?.filename,
          [`data-meta`]: attributes.data?.meta,
        }),
      },
    };
  },

  renderHTML({ HTMLAttributes }) {
    const attrs = mergeAttributes(this.options.attributes, HTMLAttributes);

    delete attrs.state;
    delete attrs.key;

    return [HTML_TAG, attrs];
  },

  parseHTML() {
    return [
      {
        tag: HTML_TAG,
      },
    ];
  },

  addCommands,

  addProseMirrorPlugins() {
    const imageNodeType = this.type;

    const acceptedFiles = buildAcceptedFileExtensions(this.options.accept);

    const imageOptions = this.options;
    return [
      new Plugin({
        key: new PluginKey("ImagePlugin"),
        props: {
          handleDOMEvents: {
            paste(view, event) {
              if (event.clipboardData == null) {
                return false;
              }

              const { tr } = view.state;
              const typeText = "text/plain";
              const typeHtml = "text/html";
              const htmlData = event.clipboardData.getData(typeHtml);
              const hasFiles = !!event.clipboardData.files.length;
              const hasItems = !!event.clipboardData.items.length;
              const hasOneTextItem =
                event.clipboardData.items.length === 1 &&
                event.clipboardData.items[0].type === typeText;

              // Skip parsing images if clipboard has HTML page from MS Word
              if (
                htmlData.includes("<meta name=ProgId content=Word.Document>")
              ) {
                return false;
              }

              // NOTE: In some OS (Windows, Linux) Firefox does not give pasted images inside clipboardData object.
              // So we can't get them from there. To process pasted images inside Firefox, we should do some post-processing operations.
              // Pay attention that returning 'true' in this case is very important. If handleDOMEvents.paste returns 'true'
              // ProseMirror doesn't call e.preventDefault, and we can get images from Firefox inside our contenteditabe block.
              if (browser.gecko && !hasFiles && (!hasItems || hasOneTextItem)) {
                processImageInGecko(
                  imageNodeType,
                  event.clipboardData.getData(typeText),
                  view,
                );

                return true;
              }

              if (!hasFiles) {
                return false;
              }

              for (const file of event.clipboardData.files) {
                const isImage = isImageDropFile(file, acceptedFiles);

                if (isImage) {
                  const attrs: Omit<ImageOptionsAttrs, "key"> = {
                    state: {
                      preparedData: {
                        file,
                      },
                    },
                  };

                  // TODO: need collect images before replacing for multi-images coping
                  tr.replaceSelectionWith(imageNodeType.create(attrs));
                  tr.setSelection(
                    NodeSelection.near(
                      tr.doc.resolve(Math.max(0, tr.selection.from - 1)),
                    ),
                  );
                }
              }

              if (tr.steps.length > 0) {
                event.preventDefault();

                view.dispatch(tr);

                return true;
              }

              return false;
            },
            dragover(view, event) {
              // Signal a copy-drop over the editor for a single local file
              // (internal block drags carry no Files). PM preventDefaults
              // every dragover over the editable area anyway; this documents
              // the intent and keeps non-file drags untouched.
              const dataTransfer = event.dataTransfer;
              if (!isSingleFileDrag(dataTransfer)) {
                return false;
              }
              event.preventDefault();
              return false;
            },
            drop(view, event) {
              const dataTransfer = event.dataTransfer;
              // Exactly one local file; multi-file and directory drags keep
              // the host behavior (batch import is out of scope).
              if (!isSingleFileDrag(dataTransfer)) {
                return false;
              }
              const file = dataTransfer!.files[0];
              const dropPos = view.posAtCoords({
                left: event.clientX,
                top: event.clientY,
              });
              // Gutter/outside areas: not a document position — keep the
              // host behavior instead of guessing.
              if (dropPos == null) return false;

              const isImage = isImageDropFile(file, acceptedFiles);
              let node;
              // Non-null exactly when an attachment chip is being inserted
              // (the image path parks nothing — its File goes into attrs,
              // see the quickDropFiles contract in attachment.ts).
              let quickDropKey: string | null = null;
              if (isImage) {
                node = imageNodeType.create({
                  state: { preparedData: { file } },
                });
              } else {
                const attachmentNodeType =
                  view.state.schema.nodes.attachment;
                // The attachment extension is part of every profile; if it
                // ever disappears, unclaimed drops keep the host behavior.
                if (attachmentNodeType == null) return false;
                // The File parks in quickDropFiles under the chip's key —
                // never in attrs: autosave serializes getJSON() verbatim and
                // a File stringifies to "{}", persisting garbage into the
                // saved note (see quickDropFiles contract in attachment.ts).
                // The key must exist before the node (it goes into its
                // attrs), but the Map entry is parked only after insertPos
                // resolves below — parking earlier would leak the file on
                // the bail-outs (no node view ever mounts to release it).
                quickDropKey = `quick_drop_${Date.now()}_${quickDropSeq++}`;
                node = attachmentNodeType.create({
                  key: quickDropKey,
                  state: { isQuickDrop: true },
                });
              }

              // Snap the raw position to a boundary where a whole block
              // fits — dropPoint is the snapping PM's own drop uses; a raw
              // mid-text position would make the block insert invalid.
              const slice = new Slice(Fragment.from(node), 0, 0);
              let insertPos = dropPoint(view.state.doc, dropPos.pos, slice);
              if (insertPos == null) {
                // The upper half of the .note title has no valid boundary
                // (NoteDoc requires the leading noteTitle) — retry at the
                // end of the top-level node under the pointer, the first
                // block boundary after the title, before giving up.
                const $raw = view.state.doc.resolve(dropPos.pos);
                if ($raw.depth >= 1) {
                  insertPos = dropPoint(
                    view.state.doc,
                    $raw.after(1),
                    slice,
                  );
                }
              }
              if (insertPos == null) return false;

              // The insert is certain now: park the file. dispatch is
              // synchronous, so the entry is in place before the view
              // update mounts the chip's node view and reads it.
              if (quickDropKey != null) {
                quickDropFiles.set(quickDropKey, file);
              }

              const { tr } = view.state;
              tr.insert(insertPos, node);
              if (isImage) {
                // Paste-path parity: the inserted image lands selected.
                tr.setSelection(NodeSelection.near(tr.doc.resolve(insertPos)));
              } else {
                // Module convention (setAttachmentViewProps): attachment
                // block transactions stay outside undo history.
                tr.setMeta("addToHistory", false);
              }

              // preventDefault stops Electron's file:// hand-off (the
              // "open with external application" path); stopPropagation
              // keeps the workspace-level drop handlers out of it.
              event.preventDefault();
              event.stopPropagation();
              view.dispatch(tr);
              return true;
            },
            dragstart(view, event) {
              if (
                imageOptions.hooks?.onDragStart &&
                isFunction(imageOptions.hooks.onDragStart)
              ) {
                imageOptions.hooks.onDragStart(view, event);
              }
            },
          },
        },
        appendTransaction: (transactions, _oldState, newState) => {
          const tr: Transaction = newState.tr;
          const trMetaNodeState = new Set<NodeStatePluginAction>();

          let isSilentTransactions = false;

          for (const oneTransaction of transactions) {
            if (oneTransaction.getMeta("addToHistory") === false) {
              isSilentTransactions = true;
            }
          }

          // Delete empty images if the editor instance is focused and current transaction is not a silent one
          if (this.editor.isFocused && !isSilentTransactions) {
            const selectedNode =
              newState.selection instanceof NodeSelection
                ? newState.selection.node
                : null;
            const keyToPos = (nodeStatePluginKey.getState(newState) ?? {
              local: [],
            }) as InternalDecorationSet;

            keyToPos.local.forEach((deco) => {
              const nodeWithState = newState.doc.nodeAt(deco.from);

              if (nodeWithState?.type !== imageNodeType) {
                return;
              }

              const attrs = nodeWithState.attrs as StateNodeAttrs;
              const specId = (deco.spec as NodeStateDecorationSpec).id;

              if (attrs.key != null && attrs.key !== specId) {
                trMetaNodeState.add({
                  remove: {
                    id: specId,
                    transactionsMeta: getTransactionsMetadata(transactions),
                  },
                });
              }

              if (
                nodeWithState != null &&
                attrs.state == null &&
                attrs.data?.id == null &&
                selectedNode !== nodeWithState
              ) {
                tr.delete(deco.from, deco.to).setMeta("addToHistory", false);

                trMetaNodeState.add({
                  remove: {
                    id: specId,
                    transactionsMeta: getTransactionsMetadata(transactions),
                  },
                });
              }
            });
          }

          if (trMetaNodeState.size > 0) {
            tr.setMeta(nodeStatePluginKey, Array.from(trMetaNodeState));

            return tr;
          }

          return null;
        },
      }),
    ];
  },

  addNodeView() {
    const element = new ImageElement();
    element.addClass("texto-extension-image-host");
    // Mobile drawer-swipe opt-out (issues/image-resize-edge-swipe): the
    // resize handles sit at the image's edges — near the screen edges on a
    // full-width image — and a drag starting on a handle (or the body)
    // was swallowed by Obsidian's shell swipe. The attribute walks up the
    // touch-target chain from BOTH the handles and the image body, so the
    // whole node area opts out — the same width as the tables' accepted
    // side effect (tableView.ts).
    element.setAttribute("data-ignore-swipe", "true");

    return ({ node, getPos, editor }) => {
      if (!isFunction(getPos)) {
        throw new Error("[TEXTO ERROR]: getPos must be a function.");
      }

      setViewProps(element, node, editor, this.options);

      for (const handle of createResizeHandles(element, editor, getPos)) {
        element.appendChild(handle);
      }

      return {
        dom: element,

        update: (updatedNode) => {
          if (updatedNode.type !== this.type) {
            return false;
          }

          setViewProps(
            element,
            updatedNode,
            editor,
            this.options,
          );

          return true;
        },
      };
    };
  },
});
