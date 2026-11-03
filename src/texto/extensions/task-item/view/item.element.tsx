import type { Editor } from "../../../core";
import { p } from "@web-companions/gfc";
import { is } from "@web-companions/h/template";
import { litView } from "@web-companions/lit";
import { type Ref, createRef, ref } from "lit-html/directives/ref.js";

import { DEFAULT_CHECKBOX_ICONS } from "../checkbox-icons";
import type { TaskItemOptions } from "../task-item";
import { itemIconNode } from "./svg/itemIcon.svgnode";

const ItemIconNode = itemIconNode();

class ItemBaseElement extends HTMLElement {
  role = "listitem";
}

export const itemElement = litView.element({
  props: {
    checked: p.req<boolean>(),
    content: p.req<HTMLDivElement>(),
    /** Whether the item has nested content (subtasks) and can be folded. */
    foldable: p.req<boolean>(),
    handleCheckboxClick: p.req<(checkboxEl: HTMLInputElement) => void>(),
    /** Dispatched on chevron click; the node view toggles the fold state. */
    handleChevronClick: p.req<() => void>(),
    editor: p.req<Editor>(),
    options: p.req<TaskItemOptions>(),
  },
  options: {
    BaseElement: ItemBaseElement,
  },
})(function* (params) {
  const refCheckbox: Ref<HTMLInputElement> = createRef();

  const onClick = (event: Event) => {
    event.stopPropagation();
    event.preventDefault();

    const checkboxEl = refCheckbox.value;
    if (checkboxEl == null) {
      return;
    }

    if (!params.editor.isEditable && !params.options.onReadOnlyChecked) {
      return;
    }

    checkboxEl.checked = !checkboxEl.checked;
    params.handleCheckboxClick(checkboxEl);
  };

  const preventDefault = (event: Event) => {
    event.preventDefault();
  };

  // The box pop must fire on a REAL false→true toggle, not on mount: a
  // note opening with checked items would pop them all (issue
  // task-item-theme review round). wasChecked seeds from the mount props.
  let wasChecked = params.checked;
  let justChecked = false;

  while (true) {
    const options = params.options ?? {};
    const isCustomSvgIcons = Array.isArray(options.checkboxIconLinks);
    // The default icon pair renders as an inline SVG with a draw-in
    // checkmark and a box pop (issue task-item-theme); any other icon set
    // keeps the plain <use> sprite path (no animation there).
    const isDefaultCheckIcons =
      isCustomSvgIcons &&
      options.checkboxIconLinks?.[0] === DEFAULT_CHECKBOX_ICONS[0] &&
      options.checkboxIconLinks?.[1] === DEFAULT_CHECKBOX_ICONS[1];
    const isCustomSvgIconsOn = isCustomSvgIcons && params.checked;
    justChecked = isDefaultCheckIcons && params.checked && !wasChecked;
    wasChecked = params.checked;

    params = yield (
      <>
        <label
          contentEditable="false"
          onclick={onClick}
          onmousedown={preventDefault} // prevent autofocus, because focus fires when mousedown is successful
        >
          {/* Fold chevron: rendered by the item itself (the label is the
					    anchor for its absolute position in the left gutter); the
					    folded state comes from the `is-folded` node decoration + CSS,
					    exactly like the heading fold chevron. */}
          {is(
            params.foldable,
            <span
              class="texto-task-fold-chevron"
              contentEditable="false"
              role="button"
              aria-label="Toggle subtasks folding"
              data-testid="task-fold-chevron"
              onpointerdown={preventDefault}
              onclick={(event: Event) => {
                // Must not reach the label's checkbox toggle handler.
                event.stopPropagation();
                event.preventDefault();
                params.handleChevronClick();
              }}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.4"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="m9 6 6 6-6 6" />
              </svg>
            </span>,
          )}

          {is(
            isDefaultCheckIcons,
            <div class="custom-icon">
              {/* Inline default checkbox (sprite twin): the checkmark is
                  a stroke that draws itself in on check (see style.css) —
                  impossible through the <use> shadow tree. */}
              <svg
                class={justChecked ? "texto-task-check is-pop" : "texto-task-check"}
                viewBox="0 0 16 16"
                fill="none"
                aria-hidden="true"
              >
                <rect
                  class="texto-task-check__box"
                  x="0.5"
                  y="0.5"
                  width="15"
                  height="15"
                  rx="4.5"
                  stroke-width="1"
                />
                <path
                  class="texto-task-check__mark"
                  d="M4.8 8L7.1 10.3L11.7 3.4"
                  fill="none"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </div>,
          )}
          {is(
            isCustomSvgIcons && !isDefaultCheckIcons,
            <div class="custom-icon">
              <ItemIconNode
                key="taskItemCustomSvgIcon"
                iconId={
                  isCustomSvgIconsOn
                    ? options.checkboxIconLinks?.[0]
                    : options.checkboxIconLinks?.[1]
                }
              />
            </div>,
          )}

          <input
            ref={ref(refCheckbox)}
            type="checkbox"
            checked={params.checked}
            class={isCustomSvgIcons ? "visually-hidden" : ""}
          ></input>
          <span></span>
        </label>
        {params.content}
      </>
    );
  }
});
