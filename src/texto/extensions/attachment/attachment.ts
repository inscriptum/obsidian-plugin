import { isFunction, mergeAttributes, Node } from "../../core";
import { legacyMediaPath } from "../block-ids";
import { elTag } from "../../../tags";
import { Plugin } from "prosemirror-state";

import { addAttachmentCommands } from "./commands";
import { getAttachmentFilterTransaction } from "./helpers/filterTransaction";
import { preventSliceNodeByType } from "./helpers/preventSliceNodeByType";
import { setAttachmentViewProps } from "./helpers/setAttachmentViewProps";
import { attachmentElement } from "./views/attachment.element";

export type AttachmentViewNodeState = {
  src?: string;
  fileStatus?: "none" | "loading" | "attached";
  text?: string;
  subtext?: string;
  isAutoOpenFileSelection?: boolean;
  /** The chip was created by an external file drop: cancelling the attach
   *  dialog removes it instead of leaving an empty block. */
  isQuickDrop?: boolean;
  preparedData?: {
    file?: File;
  };
};

export interface AttachmentOptionsHooks {
  onFileSelected?: (
    selectedFile: File | null,
    update: (attrs: Omit<AttachmentOptions["attributes"], "key">) => void,
    /** Restore the attrs as they were when the picker opened (dismiss path). */
    cancel: () => void,
  ) => void | Promise<void>;
  onClick?: (attrs: AttachmentOptions["attributes"]) => void;
}

type HTMLAttributes = "id" | "size" | "filename" | "mode";

export type AttachmentOptionsAttrs = {
  key: string;
  state?: AttachmentViewNodeState | null;
  data?: { [K in HTMLAttributes]?: string | null };
};

export interface AttachmentOptions {
  attributes: AttachmentOptionsAttrs;
  placeholderText: string;
  fileIconId?: string;
  hooks?: AttachmentOptionsHooks;
}

export const VIEW_TAG = elTag("texto-extension-attachment");
/** Static tag used in HTML serialization (clipboard/export) — stays version-independent. */
export const HTML_TAG = "texto-extension-attachment";
const AttachmentElement = attachmentElement(VIEW_TAG);

/**
 * Files dropped from the OS onto the editor, parked under the attachment
 * chip's key until its node view picks them up. CONTRACT (attachment
 * quick-drop only): a File never travels in THIS node's attrs — autosave
 * serializes editor.getJSON() verbatim, and a File stringifies to "{}", so
 * the drop would persist garbage into the saved note and a broken
 * re-attach on reopen (same policy as attachSelectedFile keeping its File
 * in a closure: nothing transient is persisted). The entry lives until the
 * attach flow settles (result dispatched, chip dismissed) or the node view
 * is disposed.
 *
 * WHY the image node is out of scope: the image drop/paste paths still
 * hand the File through node attrs (state.preparedData) and consume it in
 * the next animation frame (tools/image.ts) — a pre-existing one-frame
 * window with the same persistence risk, kept as-is for paste parity until
 * that path gets its own parking.
 */
export const quickDropFiles = new Map<string, File>();

export type AttachmentElementType = InstanceType<typeof AttachmentElement>;

// Allow to get a node's position by a key
export type KeyToPosValue = { pos: number; relPos?: object };
export type KeyToPos = Map<string, KeyToPosValue>;
export const keyToPos: KeyToPos = new Map();

export const Attachment = Node.create<AttachmentOptions>({
  name: "attachment",
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
      placeholderText: "Choose File",
    };
  },

  addAttributes() {
    return {
      key: {
        rendered: false,
        isRequired: true,
      },
      state: {
        rendered: false,
      },
      data: {
        parseHTML: (element: HTMLElement) => ({
          // data-src is the media namespace for the vault path — data-id
          // belongs to the block-ids attr. Old data-id stays a fallback so
          // clipboard HTML from earlier builds still parses; block-id-shaped
          // values are rejected (placeholder images render their block id
          // as data-id — not a vault path).
          id: element.dataset["src"] ?? legacyMediaPath(element.dataset["id"]),
          size: element.dataset["size"],
          filename: element.dataset["filename"],
          // "external" — data.id is an absolute path outside the vault;
          // absent — data.id is a vault-relative path (all existing notes).
          mode: element.dataset["mode"],
        }),
        renderHTML: (attributes: AttachmentOptions["attributes"]) => ({
          [`data-src`]: attributes.data?.id,
          [`data-size`]: attributes.data?.size,
          [`data-filename`]: attributes.data?.filename,
          [`data-mode`]: attributes.data?.mode,
        }),
      },
    };
  },

  renderHTML({ HTMLAttributes }) {
    const attrs = mergeAttributes(this.options.attributes, HTMLAttributes);
    delete attrs.state;

    return [HTML_TAG, attrs];
  },

  parseHTML() {
    return [
      {
        tag: HTML_TAG,
      },
    ];
  },

  addCommands: addAttachmentCommands,

  addProseMirrorPlugins() {
    const attachmentNodeTypeName = this.type.name;
    const preventSliceAttachments = preventSliceNodeByType.bind(
      null,
      attachmentNodeTypeName,
    );
    const editor = this.editor;

    return [
      new Plugin({
        props: {
          transformCopied: preventSliceAttachments,
          transformPasted: preventSliceAttachments,
        },
        filterTransaction: getAttachmentFilterTransaction(editor),
      }),
    ];
  },

  addNodeView() {
    const element = new AttachmentElement();
    element.addClass("texto-extension-attachment-host");

    return ({ node, getPos, editor }) => {
      if (!isFunction(getPos)) {
        throw new Error("[TEXTO ERROR]: getPos must be a function.");
      }

      setAttachmentViewProps(
        element,
        node,
        editor,
        this.options,
        getPos(),
      );

      let currentNode = node;

      return {
        dom: element,
        update: (updatedNode) => {
          if (updatedNode.type !== this.type) {
            return false;
          }

          currentNode = updatedNode;

          setAttachmentViewProps(
            element,
            updatedNode,
            editor,
            this.options,
            getPos(),
          );

          return true;
        },
        destroy: () => {
          // Dispose without an attach result (view closed, chip removed by
          // other means): release the parked quick-drop file or it leaks
          // for the whole session. A settled flow has already deleted the
          // entry, so this is a no-op there.
          quickDropFiles.delete(
            (currentNode.attrs as { key?: string }).key as string,
          );
        },
      };
    };
  },
});

export const AttachmentStub = Node.create<AttachmentOptions>({
  name: "attachment",
  group: "noteDoc",

  content: "inline*",

  parseHTML() {
    return [{ tag: "p" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "p",
      mergeAttributes(
        this.options as unknown as Record<string, unknown>,
        HTMLAttributes,
      ),
      0,
    ];
  },
});
