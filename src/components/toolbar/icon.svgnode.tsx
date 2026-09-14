import { litView } from "@web-companions/lit";
import { TOOLBAR_ICON_NAMES, type ToolbarIconName } from "../icons/iconSprite";

/**
 * Toolbar icons built with lit-html's `svg` tag (the file name contains
 * "svgnode", so vite's jsx-to-tt plugin compiles JSX with lit-html `svg` —
 * see vite/vite-plugin-jsx-to-tt.mts). Each icon is a <svg><use> that pulls
 * its shape from the shared sprite (iconSprite.ts, injected once at init).
 *
 * litView.node components are curried: `(ref?) => (props?) => node`, and the
 * jsx-to-tt compiler invokes a component with a single props object — so a JSX
 * prop like `name` cannot reach the generator. Instead we build one node per
 * name with the name captured in a closure (same pattern as the repo's
 * placeholderIconNode, which is also created once and used as <X/>).
 */
function makeToolbarIconNode(name: ToolbarIconName) {
  return litView.node(function* () {
    while (true) {
      yield (
        <svg class="note-toolbar__icon" viewBox="0 0 24 24">
          {/* href (SVG2) + xlink:href (legacy) for max <use> compatibility */}
          <use href={`#inscriptum-tlb-${name}`} xlinkHref={`#inscriptum-tlb-${name}`} />
        </svg>
      );
    }
  })();
}

export const toolbarIconNodes: Record<ToolbarIconName, ReturnType<typeof makeToolbarIconNode>> =
  Object.fromEntries(TOOLBAR_ICON_NAMES.map((name) => [name, makeToolbarIconNode(name)]));
