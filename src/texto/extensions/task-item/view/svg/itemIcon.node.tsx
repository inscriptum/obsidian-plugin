import {litView} from '@web-companions/lit';

export const itemIconNode = litView.node(function* (params: {iconId?: string}) {
	while (true) {
		params = yield (
			<svg>
				<use href={`#${params.iconId}`} />
			</svg>
		);
	}
});
