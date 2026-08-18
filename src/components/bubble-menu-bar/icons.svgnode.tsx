import { litView } from "@web-companions/lit";
import { BUBBLE_ICON_NAMES, type BubbleIconName } from "../icons/iconSprite";

/**
 * Bubble-menu icons built with lit-html's `svg` tag (the file name contains
 * "svgnode", so vite's jsx-to-tt plugin compiles the JSX with lit-html `svg` —
 * see vite/vite-plugin-jsx-to-tt.mts). Each icon is a <svg><use> that pulls
 * its shape from the shared sprite (iconSprite.ts, injected once at init).
 *
 * litView.node components are curried: `(ref?) => (props?) => node`, and the
 * jsx-to-tt compiler invokes a component with a single props object — so a JSX
 * prop like `name` cannot reach the generator. Instead we build one node per
 * name with the name captured in a closure (same pattern as the toolbar's
 * iconNodes and the repo's placeholderIconNode).
 *
 * Sizing/stroke come from CSS (`.bubble-menu-bar button svg`, `.bb-mi svg`,
 * `.bb-tick svg`) — the sprite symbol only carries the geometry.
 */
function makeBubbleIconNode(name: BubbleIconName) {
  return litView.node(function* () {
    while (true) {
      yield (
        <svg viewBox="0 0 24 24">
          <use href={`#inscriptum-bb-${name}`} xlinkHref={`#inscriptum-bb-${name}`} />
        </svg>
      );
    }
  })();
}

export const bubbleIconNodes: Record<
  BubbleIconName,
  ReturnType<typeof makeBubbleIconNode>
> = Object.fromEntries(
  BUBBLE_ICON_NAMES.map((name) => [name, makeBubbleIconNode(name)]),
);
