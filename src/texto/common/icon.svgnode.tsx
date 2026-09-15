import { litView } from "@web-companions/lit";

export const iconNode = litView.node(function* (params: {
  iconId: string;
  viewBox?: string;
}) {
  params.viewBox ??= "0 0 20 20";

  while (true) {
    params = yield (
      <svg viewBox={params.viewBox}>
        {/* href (SVG2) + xlink:href (legacy) for max <use> compatibility */}
        <use href={`#${params.iconId}`} xlinkHref={`#${params.iconId}`} />
      </svg>
    );
  }
});
