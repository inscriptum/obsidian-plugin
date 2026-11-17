import { Editor, isNodeSelection, posToDOMRect } from "../../core";
import { getFirstFromAndLastToPos } from "../../core/helpers";
import { EditorState, Plugin, PluginKey, PluginView } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import tippy, { Instance, Props } from "tippy.js";

import { shouldShowDefault } from "./helpers/shouldShow";
import { freeVerticalSpace, toolbarBottomY } from "./toolbarBoundary";
import { AnyFnVoid } from "../../../texto/core/@types";

function debounce<T extends AnyFnVoid>(fn: T, wait: number) {
  let timer: number | null = null;

  return (...args: Parameters<T>) => {
    if (timer !== null) window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), wait);
  };
}

export type ShouldShowProps = {
  editor: Editor;
  view: EditorView;
  state: EditorState;
  oldState?: EditorState;
  from: number;
  to: number;
};

export interface BubbleMenuPluginProps {
  pluginKey: PluginKey | string;

  editor: Editor;

  element: HTMLElement;

  tippyOptions?: Partial<Props>;

  updateDelay?: number;

  shouldShow?:
    | ((this: BubbleMenuView, props: ShouldShowProps) => boolean)
    | null;

  disableHideOnBlur?: boolean;
}

export type BubbleMenuViewProps = BubbleMenuPluginProps & {
  view: EditorView;
};

export class BubbleMenuView implements PluginView {
  public isMousePressed = false;

  public editor: Editor;

  public element: HTMLElement;

  public view: EditorView;

  public preventHide = false;

  public tippy: Instance | undefined;

  public tippyOptions?: Partial<Props>;

  public updateDelay: number;

  public disableHideOnBlur: boolean;

  public pluginKey: string | PluginKey;

  public shouldShow: BubbleMenuPluginProps["shouldShow"];

  constructor({
    pluginKey,
    editor,
    element,
    view,
    tippyOptions = {},
    updateDelay = 250,
    disableHideOnBlur = false,
    shouldShow,
  }: BubbleMenuViewProps) {
    this.pluginKey = pluginKey;
    this.editor = editor;
    this.element = element;
    this.view = view;
    this.updateDelay = updateDelay;
    this.disableHideOnBlur = disableHideOnBlur;

    if (shouldShow) {
      this.shouldShow = shouldShow.bind(this);
    } else {
      this.shouldShow = shouldShowDefault.bind(this);
    }

    document.addEventListener("mousedown", this.setIsMousePressed, {
      capture: true,
    });
    document.addEventListener("mouseup", this.setIsMousePressed, {
      capture: true,
    });
    document.addEventListener("mousemove", this.setIsMousePressed, {
      capture: true,
    });

    this.element.addEventListener("mousedown", this.mousedownHandler, {
      capture: true,
    });
    this.view.dom.addEventListener("dragstart", this.dragstartHandler);
    this.editor.on("focus", this.focusHandler);
    this.editor.on("blur", this.blurHandler);
    this.tippyOptions = tippyOptions;
    // Detaches menu content from its current parent
    this.element.remove();
    this.element.classList.add("is-visible");
  }

  mousedownHandler = () => {
    this.preventHide = true;
  };

  setIsMousePressed = (e: MouseEvent) => {
    const wasMousePressed = this.isMousePressed;

    this.isMousePressed = (e.buttons ?? 0) > 0;

    if (wasMousePressed && !this.isMousePressed) {
      window.setTimeout(() => this.update(this.editor.view));
    }
  };

  dragstartHandler = () => {
    this.hide();
  };

  focusHandler = () => {
    // we use `setTimeout` to make sure `selection` is already updated
    window.setTimeout(() => this.update(this.editor.view));
  };

  blurHandler = ({ event }: { event: FocusEvent }) => {
    if (this.preventHide || this.disableHideOnBlur) {
      this.preventHide = false;

      return;
    }

    if (
      event?.relatedTarget &&
      this.element.parentNode?.contains(event.relatedTarget as Node)
    ) {
      return;
    }

    this.hide();
  };

  tippyBlurHandler = (event: FocusEvent) => {
    this.blurHandler({ event });
  };

  createTooltip() {
    const { element: editorElement } = this.editor.options;
    const editorIsAttached = !!editorElement.parentElement;

    if (this.tippy || !editorIsAttached) {
      return;
    }

    this.tippy = tippy(editorElement, {
      duration: 0,
      getReferenceClientRect: null,
      content: this.element,
      interactive: true,
      trigger: "manual",
      placement: "top",
      hideOnClick: "toggle",
      ...this.tippyOptions,
    });
    this.tippy.popper.classList.add("bubble-menu-popper");

    // Send a tippy object to save inside the plugin's state
    this.editor.view.dispatch(
      this.editor.state.tr.setMeta(this.pluginKey, this.tippy),
    );

    // maybe we have to hide tippy on its own blur event as well
    if (this.tippy.popper.firstChild) {
      (this.tippy.popper.firstChild as HTMLElement).addEventListener(
        "blur",
        this.tippyBlurHandler,
      );
    }
  }

  update(view: EditorView, oldState?: EditorState) {
    const { state } = view;
    const hasValidSelection =
      state.selection.$from.pos !== state.selection.$to.pos;

    if (this.updateDelay > 0 && hasValidSelection) {
      debounce(this.updateHandler, this.updateDelay)(view, oldState);
    } else {
      this.updateHandler(view, oldState);
    }
  }

  // WHY: tall selections need an anchor inside the selection; lack of room
  // outside the selection does not imply lack of room in the viewport.
  toolbarAwareReference(
    rect: DOMRect,
  ): { rect: DOMRect; placement: "top" | "bottom" } | null {
    const { above, below } = freeVerticalSpace(
      this.editor,
      rect.top,
      rect.bottom,
    );
    const required = (this.element.offsetHeight || 44) + 8;
    if (above >= required) return { rect, placement: "top" };
    if (below >= required) return { rect, placement: "bottom" };
    const top = Math.max(0, toolbarBottomY(this.editor));
    if (window.innerHeight - top < required) return null;
    const anchorY = Math.min(
      window.innerHeight,
      Math.max(rect.top, top + required),
    );
    return {
      rect: new DOMRect(rect.left, anchorY, rect.width, 0),
      placement: "top",
    };
  }

  applyToolbarAwarePlacement(
    view: EditorView,
    from: number,
    to: number,
  ): boolean {
    if (!this.tippy) return true;
    const reference = this.toolbarAwareReference(posToDOMRect(view, from, to));
    if (reference) {
      if (this.tippy.props.placement !== reference.placement) {
        this.tippy.setProps({ placement: reference.placement });
      }
      return true;
    }
    this.hide();
    return false;
  }

  updateHandler = (view: EditorView, oldState?: EditorState) => {
    const { state, composing } = view;
    const { doc, selection } = state;
    const isSame =
      oldState && oldState.doc.eq(doc) && oldState.selection.eq(selection);

    if (composing || isSame || this.editor.isDestroyed) {
      return;
    }

    this.createTooltip();

    // support for CellSelections
    const { from, to } = getFirstFromAndLastToPos(selection.ranges);

    const shouldShow = this.shouldShow?.({
      editor: this.editor,
      view,
      state,
      oldState,
      from,
      to,
    });

    if (!shouldShow) {
      this.hide();

      return;
    }

    if (!this.applyToolbarAwarePlacement(view, from, to)) {
      return; // hidden as the last resort — keep it hidden
    }

    this.tippy?.setProps({
      getReferenceClientRect: () => {
        const custom = this.tippyOptions?.getReferenceClientRect?.call(this);
        if (custom) return this.toolbarAwareReference(custom)?.rect ?? custom;
        if (isNodeSelection(state.selection)) {
          const node = view.nodeDOM(from) as HTMLElement;

          if (node) {
            const rect = node.getBoundingClientRect();
            return this.toolbarAwareReference(rect)?.rect ?? rect;
          }
        }

        const rect = posToDOMRect(view, from, to);
        return this.toolbarAwareReference(rect)?.rect ?? rect;
      },
    });

    this.show();
  };

  show() {
    this.tippy?.show();
  }

  hide() {
    this.tippy?.hide();
  }

  destroy() {
    if (this.tippy?.popper.firstChild) {
      (this.tippy.popper.firstChild as HTMLElement).removeEventListener(
        "blur",
        this.tippyBlurHandler,
      );
    }

    document.removeEventListener("mousedown", this.setIsMousePressed, {
      capture: true,
    });
    document.removeEventListener("mouseup", this.setIsMousePressed, {
      capture: true,
    });
    document.removeEventListener("mousemove", this.setIsMousePressed, {
      capture: true,
    });

    this.tippy?.destroy();
    this.element.removeEventListener("mousedown", this.mousedownHandler, {
      capture: true,
    });
    this.view.dom.removeEventListener("dragstart", this.dragstartHandler);
    this.editor.off("focus", this.focusHandler);
    this.editor.off("blur", this.blurHandler);
  }
}

export type BubbleMenuPluginState = { tippy?: Instance };

export function bubbleMenuPlugin(options: BubbleMenuPluginProps) {
  return new Plugin({
    key:
      typeof options.pluginKey === "string"
        ? new PluginKey(options.pluginKey)
        : options.pluginKey,
    view: (view) => new BubbleMenuView({ view, ...options }),
    state: {
      init(): BubbleMenuPluginState {
        return {};
      },
      apply(tr, value) {
        const tippy = tr.getMeta(options.pluginKey) as Instance | null;

        if (tippy != null) {
          return { tippy };
        }

        return value;
      },
    },
  });
}
