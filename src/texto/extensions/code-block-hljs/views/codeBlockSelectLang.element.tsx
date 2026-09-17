import { isFunction } from "../../../core";
import { p } from "@web-companions/gfc";
import { litView } from "@web-companions/lit";

import { type SupportedLanguage, LANGUAGES } from "../utils/hljs";
import { codeBlockIconNodes } from "./codeBlockIcons.svgnode";

/** How long the copy button shows its "copied" check mark, ms. */
const COPIED_FEEDBACK_MS = 1500;

/** The generator template is rendered EXACTLY ONCE: this element proxies the
 *  code block's contentDOM (`domCodeEl`), and a generator re-render would
 *  re-create the subtree and detach it from ProseMirror (the block stops
 *  rendering updates). All dynamic behavior below is classes / direct DOM /
 *  handlers — never `this.next()`. */

export const codeBlockSelectLangElement = litView.element({
  props: {
    domCodeEl: p.req<HTMLElement>(),
    disabled: p.req<boolean>(),
    selectedLanguage: p.opt<string>(),
    onChange: p.opt<(language: SupportedLanguage | null) => void>(),
    /** Soft-wrap mode of the block (mirrors the node's `wrap` attr). */
    wrapped: p.opt<boolean>(),
    onToggleWrap: p.opt<() => void>(),
    onCopy: p.opt<() => void>(),
  },
})(function* (params) {
  const updateAttributes = (event: Event) => {
    const target = event.target as HTMLSelectElement;
    if (isFunction(params.onChange)) {
      const value = target.value as SupportedLanguage | "null";
      params.onChange(value === "null" ? null : value);
    }
  };

  // Buttons must not steal the caret/selection from the code content.
  const preventFocusSteal = (event: Event) => event.preventDefault();

  // Controls live inside the editor DOM: stop their pointer/mouse events from
  // bubbling to ProseMirror / Obsidian handlers.
  const stopBubbling = (event: Event) => event.stopPropagation();

  // Coarse pointers (mobile): the NATIVE select picker is unusable there —
  // the WebView dismisses it the moment the soft keyboard hides (a tap moves
  // focus off the editable → kbWillHide → the picker closes), and
  // showPicker() is a silent no-op on Android WebView. A custom popup list
  // avoids the native picker entirely. Toggled by class, not by re-render.
  const coarse = window.matchMedia?.("(pointer: coarse)")?.matches ?? false;

  const setLangPopup = (open: boolean) => {
    this.querySelector(".hljs-codeblock__lang-popup")?.classList.toggle(
      "show",
      open,
    );
    this.querySelector(".hljs-codeblock__lang-btn")?.classList.toggle(
      "is-open",
      open,
    );
  };

  const toggleLangPopup = (event: MouseEvent) => {
    preventFocusSteal(event);
    stopBubbling(event);
    const popup = this.querySelector(".hljs-codeblock__lang-popup");
    setLangPopup(popup != null && !popup.classList.contains("show"));
  };

  const onLangOptionClick = (event: MouseEvent) => {
    stopBubbling(event);
    const opt = (event.target as HTMLElement | null)?.closest?.("[data-lang]");
    if (opt == null) return;
    const value = (opt as HTMLElement).dataset.lang as SupportedLanguage | "";
    setLangPopup(false);
    if (isFunction(params.onChange)) {
      params.onChange(value === "" ? null : value);
    }
  };

  // Tap outside any code block controls closes the language popup.
  const onDocPointerDown = (event: PointerEvent) => {
    const target = event.target as Node | null;
    if (target == null || this.contains(target)) return;
    setLangPopup(false);
  };
  document.addEventListener("pointerdown", onDocPointerDown, true);

  const onCopyClick = (event: MouseEvent) => {
    preventFocusSteal(event);
    if (!isFunction(params.onCopy)) return;
    params.onCopy();
    const btn = this.querySelector(".hljs-codeblock__btn--copy") ?? this;
    btn.classList.add("is-copied");
    window.setTimeout(
      () => btn.classList.remove("is-copied"),
      COPIED_FEEDBACK_MS,
    );
  };

  // Soft wrap: flip the visual state IMMEDIATELY (optimistic), then let the
  // NodeView dispatch the attr change; update() re-syncs the same classes.
  const onWrapClick = (event: MouseEvent) => {
    preventFocusSteal(event);
    if (!isFunction(params.onToggleWrap)) return;
    const btn = this.querySelector(".hljs-codeblock__btn--wrap");
    const willWrap = !(btn?.classList.contains("is-active") ?? false);
    btn?.classList.toggle("is-active", willWrap);
    this.classList.toggle("is-wrapped", willWrap);
    params.onToggleWrap();
  };

  while (true) {
    params = yield (
      <>
        <pre>{params.domCodeEl}</pre>
        <div class="hljs-codeblock__controls" contentEditable={false}>
          {coarse ? (
            <div class="hljs-codeblock__lang" contentEditable={false}>
              <button
                class="hljs-codeblock__lang-btn"
                disabled={params.disabled}
                aria-label="Code language"
                onmousedown={preventFocusSteal}
                onclick={toggleLangPopup}
              >
                <span class="hljs-codeblock__lang-label">
                  {params.selectedLanguage ?? "auto"}
                </span>
              </button>
              <div class="hljs-codeblock__lang-popup">
                <button
                  class="hljs-codeblock__lang-opt"
                  data-lang=""
                  onclick={onLangOptionClick}
                >
                  auto
                </button>
                {LANGUAGES.map((lang) => (
                  <button
                    class="hljs-codeblock__lang-opt"
                    data-lang={lang}
                    onclick={onLangOptionClick}
                  >
                    {lang}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <select
              disabled={params.disabled}
              class="hljs-codeblock__select"
              contentEditable={false}
              value={params.selectedLanguage}
              onchange={updateAttributes}
            >
              <option value="null" selected={params.selectedLanguage == null}>
                auto
              </option>
              <option disabled={true}>—</option>
              {LANGUAGES.map((lang) => (
                <option
                  key={lang}
                  value={lang}
                  selected={params.selectedLanguage === lang}
                >
                  {lang}
                </option>
              ))}
            </select>
          )}
        </div>
        {/* Wrap + copy pinned to the right edge, wrap first (user preference). */}
        <div class="hljs-codeblock__actions" contentEditable={false}>
          <button
            class={`hljs-codeblock__btn hljs-codeblock__btn--wrap${params.wrapped ? " is-active" : ""}`}
            disabled={params.disabled}
            title="Toggle soft wrap"
            aria-label="Toggle soft wrap"
            aria-pressed={params.wrapped === true}
            onmousedown={preventFocusSteal}
            onclick={onWrapClick}
          >
            {codeBlockIconNodes.wrap({})}
          </button>
          <button
            class="hljs-codeblock__btn hljs-codeblock__btn--copy"
            disabled={params.disabled}
            title="Copy code"
            aria-label="Copy code"
            onmousedown={preventFocusSteal}
            onclick={onCopyClick}
          >
            <span class="hljs-codeblock__btn-ico hljs-codeblock__btn-ico--copy">
              {codeBlockIconNodes.copy({})}
            </span>
            <span class="hljs-codeblock__btn-ico hljs-codeblock__btn-ico--check">
              {codeBlockIconNodes.check({})}
            </span>
          </button>
        </div>
      </>
    );
  }
});
