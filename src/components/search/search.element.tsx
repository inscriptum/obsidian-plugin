import { litView } from "@web-companions/lit";
import { p } from "@web-companions/gfc";
import { Editor } from "../../texto/core";
import {
  documentSearchKey,
  getDocumentSearchState,
} from "../../search/documentSearch";
import { elTag } from "../../tags";

const OPEN_EVENT = "open-search";
const CLOSE_EVENT = "close-search";

export const SearchElement = litView.element({
  props: {
    editor: p.req<Editor>(),
  },
})(function* (props) {
  let isOpen = false;

  const getInput = () => this.querySelector<HTMLInputElement>("input");

  const scrollToActiveMatch = () => {
    window.requestAnimationFrame(() => {
      if (!isOpen) return;
      props.editor.view.dom
        .querySelector<HTMLElement>(".inscriptum-search-match-active")
        ?.scrollIntoView({ block: "center", inline: "nearest" });
    });
  };

  const focusInput = (select = false) => {
    window.requestAnimationFrame(() => {
      const input = getInput();
      input?.focus();
      if (select) input?.select();
    });
  };

  const open = () => {
    isOpen = true;
    void this.next().then(() => focusInput(true));
  };

  const close = () => {
    isOpen = false;
    const input = getInput();
    if (input) input.value = "";
    props.editor.view.dispatch(
      props.editor.state.tr.setMeta(documentSearchKey, { clear: true }),
    );
    void this.next().then(() => props.editor.view.focus());
  };

  const setQuery = (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    props.editor.view.dispatch(
      props.editor.state.tr.setMeta(documentSearchKey, {
        query: input.value,
        activeIndex: 0,
      }),
    );
    void this.next().then(scrollToActiveMatch);
  };

  const moveToMatch = (direction: number) => {
    const searchState = getDocumentSearchState(props.editor.state);
    if (searchState.matches.length === 0) return;

    const activeIndex =
      (searchState.activeIndex + direction + searchState.matches.length) %
      searchState.matches.length;
    props.editor.view.dispatch(
      props.editor.state.tr.setMeta(documentSearchKey, { activeIndex }),
    );
    void this.next().then(scrollToActiveMatch);
  };

  const handleKeydown = (event: KeyboardEvent) => {
    if (event.key === "Enter") {
      event.preventDefault();
      moveToMatch(event.shiftKey ? -1 : 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  };

  const refresh = () => {
    void this.next();
  };

  this.addEventListener(OPEN_EVENT, open);
  this.addEventListener(CLOSE_EVENT, close);
  props.editor.on("transaction", refresh);

  try {
    while (true) {
      const searchState = getDocumentSearchState(props.editor.state);
      const { query, matches, activeIndex } = searchState;

      props = yield (
        <div
          class={`inscriptum-search-bar${isOpen ? " is-open" : ""}`}
          role="search"
          aria-label="Find in note"
        >
          <input
            type="search"
            placeholder="Find in note"
            aria-label="Search this note"
            autocomplete="off"
            spellcheck="false"
            value={query}
            oninput={setQuery}
            onkeydown={handleKeydown}
          />
          <span class="inscriptum-search-count" aria-live="polite">
            {!query
              ? ""
              : matches.length === 0
                ? "No matches"
                : `${activeIndex + 1} of ${matches.length}`}
          </span>
          <button
            type="button"
            class="inscriptum-search-button"
            aria-label="Previous match"
            title="Previous match"
            disabled={matches.length === 0}
            onclick={() => moveToMatch(-1)}
          >
            ‹
          </button>
          <button
            type="button"
            class="inscriptum-search-button"
            aria-label="Next match"
            title="Next match"
            disabled={matches.length === 0}
            onclick={() => moveToMatch(1)}
          >
            ›
          </button>
          <button
            type="button"
            class="inscriptum-search-button"
            aria-label="Close search"
            title="Close search"
            onclick={close}
          >
            ×
          </button>
        </div>
      );
    }
  } finally {
    this.removeEventListener(OPEN_EVENT, open);
    this.removeEventListener(CLOSE_EVENT, close);
    props.editor.off("transaction", refresh);
  }
})(elTag("inscriptum-search"));
