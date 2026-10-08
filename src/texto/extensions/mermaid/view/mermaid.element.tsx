import { p } from "@web-companions/gfc";
import { litView } from "@web-companions/lit";

import { mermaidIconNodes } from "./mermaidIcons.svgnode";

/**
 * Static dual-face chrome of a mermaid block: the SVG view and the inline
 * source editor. The view face carries no controls — editing is reached via
 * the media bubble menu ("Edit diagram"), which asks the NodeView through the
 * MERMAID_EDIT_EVENT; the NodeView flips the is-editing class.
 *
 * The generator template is rendered EXACTLY ONCE (same contract as
 * codeBlockSelectLang.element.tsx): mode switches, rendering and state live
 * in the NodeView closure as classes / direct DOM — never `this.next()`.
 * Handlers close over the first-render `params`, so the NodeView assigns the
 * callbacks before the element is connected (a props mutation alone does not
 * re-render the generator).
 */
export const mermaidElement = litView.element({
  props: {
    onSave: p.opt<(code: string) => void>(),
    onCancel: p.opt<() => void>(),
    onInput: p.opt<(code: string) => void>(),
  },
})(function* (params) {
  const host: HTMLElement = this;

  const textarea = (): HTMLTextAreaElement =>
    host.querySelector(".mermaid-editor__input") as HTMLTextAreaElement;

  // Controls must not steal the caret/selection from ProseMirror before the
  // handler runs (the NodeView keeps the selection on the node).
  const preventFocusSteal = (event: Event) => event.preventDefault();
  const stopBubbling = (event: Event) => event.stopPropagation();

  const requestSave = (event?: Event) => {
    event?.preventDefault();
    event?.stopPropagation();
    params.onSave?.(textarea().value);
  };

  const requestCancel = (event?: Event) => {
    event?.preventDefault();
    event?.stopPropagation();
    params.onCancel?.();
  };

  const onInput = (event: Event) => {
    stopBubbling(event);
    params.onInput?.((event.target as HTMLTextAreaElement).value);
  };

  const onKeydown = (event: KeyboardEvent) => {
    stopBubbling(event);
    if (event.key === "Escape") {
      event.preventDefault();
      requestCancel();
    } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      requestSave();
    }
  };

  // Click outside the block (focus left the whole editor face) = cancel —
  // the draft is discarded, the saved diagram stays. The zero-delay check
  // lets focus land on the Save/Cancel buttons first (their mousedown
  // already prevents the blur, this is the belt to its suspenders).
  const onBlur = () => {
    window.setTimeout(() => {
      const active = document.activeElement;
      if (active == null || !host.contains(active)) {
        params.onCancel?.();
      }
    }, 0);
  };

  while (true) {
    params = yield (
      <div class="mermaid-body">
        <div class="mermaid-view" contentEditable={false}>
          <div class="mermaid-view__svg"></div>
          <div class="mermaid-view__message"></div>
          <div class="mermaid-view__loading">Rendering…</div>
        </div>
        <div class="mermaid-editor" contentEditable={false}>
          <textarea
            class="mermaid-editor__input"
            spellcheck={false}
            autocomplete="off"
            oninput={onInput}
            onkeydown={onKeydown}
            onblur={onBlur}
          ></textarea>
          {/* The non-textarea chrome must not become the focus target: a
              mousedown there would blur the textarea and the blur handler
              would cancel the draft. preventDefault keeps the focus in the
              textarea (caret placement inside the textarea stays native). */}
          <div
            class="mermaid-editor__status"
            onmousedown={preventFocusSteal}
          ></div>
          <div
            class="mermaid-editor__actions"
            onmousedown={preventFocusSteal}
          >
            <button
              class="mermaid-editor__btn mermaid-editor__btn--save"
              type="button"
              aria-label="Save diagram"
              title="Save (Ctrl/Cmd+Enter)"
              onmousedown={preventFocusSteal}
              onclick={requestSave}
            >
              {mermaidIconNodes.check({})}
            </button>
            <button
              class="mermaid-editor__btn mermaid-editor__btn--cancel"
              type="button"
              aria-label="Cancel editing"
              title="Cancel (Esc)"
              onmousedown={preventFocusSteal}
              onclick={requestCancel}
            >
              {mermaidIconNodes.x({})}
            </button>
          </div>
        </div>
      </div>
    );
  }
});
