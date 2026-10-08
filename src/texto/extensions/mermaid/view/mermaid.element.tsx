import { p } from "@web-companions/gfc";
import { litView } from "@web-companions/lit";

import { mermaidIconNodes } from "./mermaidIcons.svgnode";

/**
 * Static dual-face chrome of a mermaid block: the SVG view and the inline
 * source editor. The editor face REUSES the code block's component chrome
 * (`.hljs-codeblock` — frame, font, line-number gutter, controls/actions
 * rows; see code-block-hljs/style.css): a highlighted-in-place backdrop pre
 * carries the frame and a borderless transparent textarea floats on top of
 * it as the editing surface (caret only). The view face itself carries no
 * controls — editing is reached via the media bubble menu ("Edit diagram"),
 * which asks the NodeView through the MERMAID_EDIT_EVENT.
 *
 * The generator template is rendered EXACTLY ONCE (same contract as
 * codeBlockSelectLang.element.tsx): mode switches, rendering and state live
 * in the NodeView closure as classes / direct DOM — never `this.next()`.
 * Handlers close over the first-render `params` and drive the draft DOM
 * directly (backlight rows, scroll sync), like the code block's own element.
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
  const backlight = (): HTMLElement =>
    host.querySelector(".mermaid-editor__code") as HTMLElement;

  // Controls must not steal the caret/selection from ProseMirror before the
  // handler runs (the NodeView keeps the selection on the node).
  const preventFocusSteal = (event: Event) => event.preventDefault();
  const stopBubbling = (event: Event) => event.stopPropagation();

  /** Mirror the draft into the backdrop rows (one .l row per line, matching
   *  the code block's line-number structure). Only the rows container is
   *  replaced — the lit-managed textarea beside it stays put. */
  const syncBacklight = () => {
    const t = textarea();
    const rowsHost = host.querySelector(".mermaid-editor__rows");
    if (t == null || rowsHost == null) return;
    const rows = t.value.split("\n").map((line) => {
      const div = document.createElement("div");
      div.className = "l";
      // empty rows keep their line height via a zero-width space
      div.textContent = line === "" ? "\u200b" : line;
      return div;
    });
    rowsHost.replaceChildren(...rows);
  };

  /** The textarea owns scrolling (invisible scrollbars); the backdrop
   *  follows its scroll offsets. */
  const syncScroll = () => {
    const t = textarea();
    const code = backlight();
    if (t != null && code != null) {
      code.scrollLeft = t.scrollLeft;
      code.scrollTop = t.scrollTop;
    }
  };

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
    syncBacklight();
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
        {/* The editor face = the code block component chrome. The static
            "mermaid" label sits where the language picker lives in real code
            blocks; Save/Cancel reuse the block's action buttons. */}
          <div class="mermaid-editor hljs-codeblock" contentEditable={false}>
            {/* pre and code are written without any whitespace between
                tags: a stray newline text node inside pre renders as a
                blank line above the draft (white-space: pre). The rows
                container (display: contents) holds the backdrop rows; the
                textarea is the borderless overlay on the code text box. */}
            <pre class="mermaid-editor__backlight"><code class="mermaid-editor__code language-plaintext"><span class="mermaid-editor__rows"></span><textarea
              class="mermaid-editor__input"
              spellcheck={false}
              autocomplete="off"
              oninput={onInput}
              onkeydown={onKeydown}
              onblur={onBlur}
              onscroll={syncScroll}
            ></textarea></code></pre>
            <div
              class="mermaid-editor__status"
              contentEditable={false}
              onmousedown={preventFocusSteal}
            ></div>
            <div
              class="hljs-codeblock__controls"
              contentEditable={false}
              onmousedown={preventFocusSteal}
            >
              <span class="hljs-codeblock__lang-btn" aria-hidden="true">
                <span class="hljs-codeblock__lang-label">mermaid</span>
              </span>
            </div>
            <div
              class="hljs-codeblock__actions"
              contentEditable={false}
              onmousedown={preventFocusSteal}
            >
              <button
                class="hljs-codeblock__btn mermaid-editor__btn--save"
                type="button"
                aria-label="Save diagram"
                title="Save (Ctrl/Cmd+Enter)"
                onmousedown={preventFocusSteal}
                onclick={requestSave}
              >
                {mermaidIconNodes.check({})}
              </button>
              <button
                class="hljs-codeblock__btn mermaid-editor__btn--cancel"
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
