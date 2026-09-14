import { litView } from "@web-companions/lit";

export const imageErrorIconNode = litView.node(function* (params: {
  iconId: string;
}) {
  while (true) {
    params = yield (
      <svg viewBox="0 0 40 40">
        {/* href (SVG2) + xlink:href (legacy) for max <use> compatibility */}
        <use href={`#${params.iconId}`} xlinkHref={`#${params.iconId}`} />
      </svg>
    );
  }
});
