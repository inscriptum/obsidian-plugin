import { litView } from "@web-companions/lit";
import { p } from "@web-companions/gfc";
import { Editor } from "../../texto/core";
import { elTag } from "../../tags";
import { createRef, Ref, ref } from "lit-html/directives/ref.js";

export const NoteElement = litView.element({
  props: {
    editor: p.opt<Editor>(),
    editorContainerEl: p.opt<Ref<HTMLDivElement>>(),
  },
})(function* (props) {
  props.editorContainerEl = createRef<HTMLDivElement>();

  try {
    while (true) {
      props = yield (
        <div class="note">
          {/* SVG checkbox icons for TaskItem:
              rendered hidden, TaskItem references them via <use href="#id">.
              Shape and proportions from the design — a rounded 16×16 square with border and checkmark. */}
          <div class="visually-hidden" aria-hidden="true">
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <g id="check_box_off_20">
                <rect
                  x="0.5"
                  y="0.5"
                  width="15"
                  height="15"
                  rx="4.5"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1"
                />
              </g>
            </svg>
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <g id="check_box_on_20">
                <rect
                  x="0.5"
                  y="0.5"
                  width="15"
                  height="15"
                  rx="4.5"
                  fill="rgba(124, 106, 247, .14)"
                  stroke="rgba(124, 106, 247, .55)"
                  stroke-width="1"
                />
                <path
                  d="M4.8 8L7.1 10.3L11.7 3.4"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </g>
            </svg>
          </div>
          <article
            ref={ref(props.editorContainerEl)}
            class="texto-editor"
          ></article>
        </div>
      );
    }
  } finally {
    props.editorContainerEl?.value?.firstChild?.remove();

    if (props.editor != null) {
      props.editor.destroy();
    }
  }
})(elTag("texto-editor"));
