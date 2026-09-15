import { litView } from "@web-companions/lit";

export const iconNode = litView.node(function* (params: {
  iconId: string;
  viewBox?: string;
}) {
  while (true) {
    // Normalize on EVERY iteration, not once before the loop: the node's
    // generator is shared between all consumers, and every re-render replaces
    // `params` with the caller's props — which may omit `viewBox`. A wiped
    // viewBox (viewBox="") drops the svg's intrinsic ratio, and the icon
    // blows up to the browser default 300×150 (the attachment icon bug after
    // a drag-move recreates the node view).
    params ??= { iconId: "" };
    params.viewBox ??= "0 0 20 20";

    // Explicit width/height (like the other icon nodes) so the svg is
    // self-sized regardless of the surrounding CSS.
    params = yield (
      <svg
        width="20"
        height="20"
        viewBox={params.viewBox}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* href (SVG2) + xlink:href (legacy) for max <use> compatibility */}
        <use href={`#${params.iconId}`} xlinkHref={`#${params.iconId}`} />
      </svg>
    );
  }
});
