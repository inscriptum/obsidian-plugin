import {litView} from '@web-companions/lit';

import {placeholderIconNode} from './placeholderIcon.node';

const PlaceholderIconNode = placeholderIconNode();

export const imageLoadingNode = litView.node(function* (params: {text: string; subtext: string}) {
	while (true) {
		params = yield (
			<div class="block-wrap">
				<div class="block loading-block">
					<div class="icon-note-wrap">{<PlaceholderIconNode />}</div>
					<div class="info-wrap">
						<span class="text">{params.text}</span>
						<span class="subtext">{params.subtext}</span>
					</div>
				</div>
			</div>
		);
	}
});
