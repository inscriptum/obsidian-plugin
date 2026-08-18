import {litView} from '@web-companions/lit';

export const itemIconNode = litView.node(function* (params: {iconId?: string}) {
	while (true) {
		params = yield (
			<svg>
				{/* href (SVG2) + xlink:href (legacy) for max <use> compatibility */}
				<use href={`#${params.iconId}`} xlinkHref={`#${params.iconId}`} />
			</svg>
		);
	}
});
