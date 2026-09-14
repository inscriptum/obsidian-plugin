import { type Editor, isFunction } from "../../../core";
import {
  type NodeStatePluginAction,
  findPosByKey,
  nodeStatePluginKey,
} from "../../state";
import type { Node as ProseMirrorNode } from "prosemirror-model";

import type {
  ImageElement,
  ImageElementPublicProps,
  ImageLayout,
  ImageOptions,
  ImageOptionsAttrs,
  UpdateFn,
  ViewNodeState,
} from "../image";

/** Host-element classes per image layout (see styles/image.css). */
const LAYOUT_CLASSES: Partial<Record<ImageLayout, string>> = {
  center: "texto-image-layout-center",
  right: "texto-image-layout-right",
  full: "texto-image-layout-full",
  "wrap-left": "texto-image-layout-wrap-left",
  "wrap-right": "texto-image-layout-wrap-right",
};

/** Sync the host element class list and explicit width with node attrs. */
function syncLayoutStyles(element: HTMLElement, attrs: ImageOptionsAttrs): void {
  for (const cls of Object.values(LAYOUT_CLASSES)) {
    element.classList.remove(cls);
  }
  const layoutClass = LAYOUT_CLASSES[attrs.align as ImageLayout];
  if (layoutClass != null) {
    element.classList.add(layoutClass);
  }

  // Explicit user width (percent string) overrides the layout default;
  // empty string falls back to the CSS width of the current layout.
  element.style.width = attrs.width ?? "";
}

export function setViewProps(
  element: InstanceType<typeof ImageElement>,
  node: ProseMirrorNode,
  editor: Editor,
  options: ImageOptions,
) {
  const attrs = node.attrs as ImageOptionsAttrs;

  syncLayoutStyles(element, attrs);

  const updateAttrs = getUpdateAttrsFn(editor, node);

  let publicProps: ImageElementPublicProps | undefined = {
    state: normalizeViewState(attrs),
    data: attrs.data ?? {},
    options,
  };

  if (isFunction(options.hooks?.onSetViewProps)) {
    publicProps = options.hooks.onSetViewProps(publicProps, updateAttrs);
  }

  if (publicProps != null) {
    element.props = {
      ...publicProps,
      key: attrs.key,
      onOpenFileSelection: () => {
        editor.commands.blur();
        updateAttrs({ ...node.attrs, state: null });
      },
      onRemove: (event: MouseEvent) => {
        event.stopPropagation();
        event.preventDefault();

        removeImage(editor, node);
      },
      updateAttrs,
    };
  }
}

function normalizeViewState(attrs: ImageOptionsAttrs) {
  if (attrs.state == null) {
    return undefined;
  }

  const viewState: ViewNodeState = {
    text: "",
    subtext: "",
    ...attrs.state,
  };

  if (viewState.text === "undefined") {
    viewState.text = "";
  }

  if (viewState.subtext === "undefined") {
    viewState.subtext = "";
  }

  return viewState;
}

function getUpdateAttrsFn(editor: Editor, node: ProseMirrorNode): UpdateFn {
  return (
    updatedAttrs: Omit<ImageOptionsAttrs, "key">,
    preventUpdate = false,
  ) => {
    if (editor.isDestroyed) {
      console.warn(
        `[TEXTO WARN]: The editor instance was destroyed. Can't update attributes for a node "${node.type.name}"`,
      );

      return;
    }

    const { view, state } = editor;
    const pos = findPosByKey(state, node.attrs.key as string);

    if (pos != null) {
      view.dispatch(
        state.tr
          .setNodeMarkup(pos, node.type, {
            ...updatedAttrs,
            key: node.attrs.key as string,
          })
          .setMeta("addToHistory", false)
          .setMeta("preventUpdate", preventUpdate),
      );
    } else {
      console.warn(
        `[TEXTO WARN]: Updating attributes for a node "${node.type.name}" was terminated due to unknown position for ${node.attrs.key} key`,
      );
    }
  };
}

function removeImage({ view, state }: Editor, node: ProseMirrorNode) {
  const key = node.attrs.key as string;
  const action: NodeStatePluginAction = {
    remove: {
      id: key,
      explicit: true,
      transactionsMeta: { isChangeOrigin: false, isSilent: true },
    },
  };
  const pos = findPosByKey(state, key);

  if (pos != null) {
    view.dispatch(
      state.tr
        .deleteRange(pos, pos + node.nodeSize)
        .setMeta(nodeStatePluginKey, action)
        .setMeta("addToHistory", false),
    );
  }
}
