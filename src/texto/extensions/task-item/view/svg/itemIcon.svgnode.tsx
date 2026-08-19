import {litView} from '@web-companions/lit';

export const itemIconNode = litView.node(function* (params: {iconId?: string}) {
	while (true) {
		params = yield (
			<svg viewBox="0 0 16 16">
				{/* href (SVG2) + xlink:href (legacy) for max <use> compatibility */}
				<use href={`#${params.iconId}`} xlinkHref={`#${params.iconId}`} />
			</svg>
		);
	}
});
