import { isFunction } from "../../../core/utilities";
import type { Editor } from "../../../core";

export interface ResizeParams {
  /** Image width at drag start, px. */
  startWidth: number;
  /** Pointer delta since drag start, px (positive = moved right). */
  dx: number;
  /** Which handle is being dragged. */
  side: "left" | "right";
  /** Editor content width, px. */
  contentWidth: number;
}

export const MIN_IMAGE_WIDTH_PX = 80;
export const MIN_IMAGE_WIDTH_PERCENT = 5;
export const MAX_IMAGE_WIDTH_PERCENT = 100;

/**
 * Pure math for image resize: converts a pointer drag into a new image
 * width as a percent of the editor content width.
 */
export function computeResizePercent({
  startWidth,
  dx,
  side,
  contentWidth,
}: ResizeParams): number {
  if (contentWidth <= 0) {
    return MIN_IMAGE_WIDTH_PERCENT;
  }

  // Dragging the right handle outwards grows the image; the left handle mirrors.
  const delta = side === "right" ? dx : -dx;
  const newWidth = Math.max(MIN_IMAGE_WIDTH_PX, startWidth + delta);
  const percent = Math.round((newWidth / contentWidth) * 100);

  return Math.min(MAX_IMAGE_WIDTH_PERCENT, Math.max(MIN_IMAGE_WIDTH_PERCENT, percent));
}

/**
 * Builds the left/right resize handles for an image node view.
 * Handles are visible only while the node is selected (CSS). During a drag
 * the width is applied inline for live feedback, and committed to the node
 * attrs (as a percent string) in a single undoable transaction on pointerup.
 */
export function createResizeHandles(
  element: HTMLElement,
  editor: Editor,
  getPos: () => number | undefined,
): HTMLElement[] {
  const makeHandle = (side: "left" | "right") => {
    const handle = document.createElement("div");
    handle.className = `image-resize-handle image-resize-handle-${side}`;

    handle.addEventListener("pointerdown", (event: PointerEvent) => {
      if (event.button !== 0) return;
      if (editor.view.editable === false) return;

      event.preventDefault();
      event.stopPropagation();

      const startWidth = element.getBoundingClientRect().width;
      const contentWidth = editor.view.dom.clientWidth || startWidth;
      if (startWidth <= 0 || contentWidth <= 0) return;

      const startX = event.clientX;
      let lastPercent: number | null = null;

      const onMove = (moveEvent: PointerEvent) => {
        const percent = computeResizePercent({
          startWidth,
          dx: moveEvent.clientX - startX,
          side,
          contentWidth,
        });
        if (percent !== lastPercent) {
          lastPercent = percent;
          element.style.width = `${percent}%`;
        }
      };

      const onUp = () => {
        window.removeEventListener("pointermove", onMove, true);
        window.removeEventListener("pointerup", onUp, true);
        document.body.classList.remove("texto-image-resizing");

        if (lastPercent == null) return;

        const pos = isFunction(getPos) ? getPos() : undefined;
        if (pos == null) return;

        const $pos = editor.view.state.doc.resolve(pos);
        const node = $pos.nodeAfter;
        if (node == null || node.type.name !== "image") return;

        editor.view.dispatch(
          editor.view.state.tr.setNodeMarkup(pos, node.type, {
            ...node.attrs,
            width: `${lastPercent}%`,
          }),
        );
      };

      document.body.classList.add("texto-image-resizing");
      window.addEventListener("pointermove", onMove, true);
      window.addEventListener("pointerup", onUp, true);
    });

    return handle;
  };

  return [makeHandle("left"), makeHandle("right")];
}
