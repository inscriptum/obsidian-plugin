import { litView } from "@web-companions/lit";

/**
 * The heading-fold chevron, following the repo's custom-element view pattern
 * (see extensions/image/view, extensions/task-item/view): a litView.element
 * component factory registered under a versioned tag (elTag, see tags.ts) by
 * the HeadingFolding extension. Rendered inside a ProseMirror widget
 * decoration (see foldingPlugin.ts, createChevronDom).
 *
 * litView renders into the host element itself (light DOM, container = this),
 * so the host carries the layout class and the inner <span> is just the
 * click/hover surface. The element renders static markup only: the folded
 * state is NOT a prop — ProseMirror reuses a widget's DOM while the decoration
 * `spec.key` stays equal (WidgetType.eq), so a prop would never re-render.
 * The heading's node decoration adds `.is-folded` to the <hN>, and CSS rotates
 * the nested chevron (`.is-folded > .texto-heading-fold-chevron-host`), like
 * Obsidian styles `.is-collapsed .collapse-indicator`.
 *
 * SVG attributes are string-literal kebab-case (like note.element.tsx): in
 * HTML-mode tsx the jsx-to-tt preset maps identifier attributes to lit-html
 * properties (`.strokeWidth`), which SVG elements don't have.
 */
export const chevronElement = litView.element({})(function* () {
  const prevent = (event: Event) => {
    // Never let PM start a selection or move the caret: the chevron sits
    // inside the heading's inline content flow.
    event.preventDefault();
    event.stopPropagation();
  };

  while (true) {
    yield (
      <span
        class="texto-heading-fold-chevron"
        contentEditable="false"
        role="button"
        aria-label="Toggle section folding"
        data-testid="heading-fold-chevron"
        onpointerdown={prevent}
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
      </span>
    );
  }
});
