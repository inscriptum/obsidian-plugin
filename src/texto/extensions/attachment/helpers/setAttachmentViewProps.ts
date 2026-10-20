import { type Editor, isFunction } from "../../../core";
import { NodeSelection } from "prosemirror-state";
import type { Node as ProseMirrorNode } from "prosemirror-model";

import {
  type AttachmentElementType,
  type AttachmentOptions,
  type AttachmentViewNodeState,
  keyToPos,
} from "../attachment";
import { createPositions } from "./createPositions";

/**
 * Per-element click gate state. A chip click must not open the file right
 * away: the first click only selects (the media bubble menu follows), and a
 * click on an ALREADY selected chip opens. The selection snapshot cannot be
 * taken in the click handler — ProseMirror applies the mousedown selection
 * before the click event fires — so a mousedown listener records the
 * pre-selection state (our listener runs on the node view element, before
 * ProseMirror's bubble-phase handler on the editor DOM).
 */
const clickGates = new WeakMap<
  AttachmentElementType,
  { wasSelected: boolean; read: (() => boolean) | null }
>();

/**
 * Set or update properties for AttachmentElement
 * All transactions will be done with addToHistory=false flag to prevent using history with attachment blocks
 * NOTE: A transaction with addToHistory set to false will, in principle, create content that can’t be removed by undoing.
 *
 * @param element an instance of AttachmentElement
 * @param node a node with state
 * @param editor an editor instance
 * @param options the extension options
 * @param startPos a node's position at this time
 * @param keyToPos getting an actual node's position depends on attributes
 */
export function setAttachmentViewProps(
  element: AttachmentElementType,
  node: ProseMirrorNode,
  editor: Editor,
  options: AttachmentOptions,
  startPos: number,
) {
  const attrs = node.attrs as AttachmentOptions["attributes"];
  // Try to restore this key from keyToPos if it's not empty
  if (attrs.key == null && keyToPos.size > 0) {
    for (const [key, value] of keyToPos.entries()) {
      if (startPos === value.pos) {
        attrs.key = key;
        break;
      }
    }
  }

  // Init a new key
  attrs.key ??= String(`${Date.now()}_${startPos}`);

  // Set init position
  keyToPos.set(attrs.key, createPositions(editor.state, startPos));

  // Note: the chip has no delete button — removing an attachment goes
  // through the media bubble menu's trash (removeMediaNode), which unlinks
  // the node and never touches the linked file.

  // Transactions in properties are running inside a callback function.
  // We don't know when their code will be run and which a node's position will be at that time.
  // So that, we will get the node's position by a unique key.
  const existingGate = clickGates.get(element);
  const gate = existingGate ?? { wasSelected: false, read: null };
  if (!existingGate) {
    clickGates.set(element, gate);
    element.addEventListener("mousedown", () => {
      gate.wasSelected = gate.read ? gate.read() : false;
    });
  }
  gate.read = () => {
    const pos = keyToPos.get(attrs.key)?.pos;
    const sel = editor.state.selection;
    return pos != null && sel instanceof NodeSelection && sel.from === pos;
  };

  element.props = {
    options,
    state: prepareViewState(attrs, options),
    onFileSelected: (selectedFile) => {
      onFileSelected(
        {
          editor,
          node,
          options,
          key: attrs.key,
        },
        selectedFile,
      );
    },
    onClick: () => {
      // Open only on a click that found the chip already selected; a fresh
      // click just selects the node and brings up the media bubble menu.
      if (gate.wasSelected && isFunction(options.hooks?.onClick)) {
        options.hooks.onClick(attrs);
      }
    },
  };

  const selectedFile = attrs.state?.preparedData?.file;
  if (selectedFile != null) {
    onFileSelected(
      {
        editor,
        node,
        options,
        key: attrs.key,
      },
      selectedFile,
    );
  }

  removeTempStateOptions(node, editor, startPos);
}

function onFileSelected(
  context: {
    editor: Editor;
    node: ProseMirrorNode;
    options: AttachmentOptions;
    key: string;
  },
  selectedFile: File | null,
) {
  const { options, key, editor, node } = context;

  // The link-or-copy dialog can stay open across unrelated edits; after a
  // whole-doc replacement a mapped position may point at a different node —
  // never rewrite that node's markup.
  const dispatchAttrs = (
    attrs: Omit<AttachmentOptions["attributes"], "key">,
  ) => {
    const position = keyToPos.get(key);
    if (position == null) return;
    const target = editor.view.state.doc.nodeAt(position.pos);
    if (target?.type !== node.type) return;
    editor.view.dispatch(
      editor.view.state.tr
        .setNodeMarkup(position.pos, node.type, attrs)
        .setMeta("addToHistory", false),
    );
  };

  if (isFunction(options.hooks?.onFileSelected)) {
    void options.hooks.onFileSelected(
      selectedFile,
      dispatchAttrs,
      () => {
        // Dismiss path (e.g. the link-or-copy dialog was cancelled): put the
        // attrs back as they were when the picker opened — placeholder for a
        // fresh block, the previous file for a replace — and drop the
        // prepared file so the picker does not re-trigger.
        // PM attrs are untyped; this node is guaranteed to be an attachment
        // node, so read the previous attrs through the schema type.
        const prevAttrs = node.attrs as AttachmentOptions["attributes"];
        dispatchAttrs({
          state: { ...prevAttrs.state, preparedData: undefined },
          data: prevAttrs.data,
        });
      },
    );
  }
}

function prepareViewState(
  attrs: AttachmentOptions["attributes"],
  options: AttachmentOptions,
) {
  let viewState: AttachmentViewNodeState = {
    src: "",
    fileStatus: "none",
    text: options.placeholderText,
    subtext: "",
    ...attrs.state,
  };

  if (viewState.fileStatus !== "loading" && attrs.data?.id != null) {
    viewState = {
      ...viewState,
      fileStatus: "attached",
      text: attrs.data.filename ?? attrs.data.id,
      // External links show the absolute path on the chip — the only place
      // the user can see which file the link points to; it also survives
      // reopen (state is transient, data is not).
      subtext:
        attrs.data.mode === "external" ? attrs.data.id : viewState.subtext,
    };
  }

  return viewState;
}

/**
 * Make an additional transaction if isAutoOpenFileSelection is true to prevent next auto opening
 * NOTE: This function can be expanded to change another "only once used" parameters
 *
 * @param node a node with state
 * @param editor an editor instance
 * @param pos the node's position
 */
function removeTempStateOptions(
  node: ProseMirrorNode,
  editor: Editor,
  pos: number,
) {
  const attrs = node.attrs as AttachmentOptions["attributes"];

  if (attrs.state?.isAutoOpenFileSelection) {
    attrs.state.isAutoOpenFileSelection = false;
    editor.view.dispatch(
      editor.view.state.tr
        .setNodeMarkup(pos, node.type, attrs)
        .setMeta("addToHistory", false),
    );
  }
}
