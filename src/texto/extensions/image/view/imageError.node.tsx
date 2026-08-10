import {litView} from '@web-companions/lit';

import {placeholderDeleteIconNote} from './placeholder.deleteIcon.node';
import {placeholderNotFoundIcon} from './placeholderNotFoundIcon.node';

const PlaceholderNotFoundIconNode = placeholderNotFoundIcon();
const PlaceholderDeleteIconNode = placeholderDeleteIconNote();

export const imageErrorNode = litView.node(function* (params: {
	text: string;
	onRemove?: (ev: MouseEvent) => void;
}) {
	while (true) {
		params = yield (
			<div class="block-wrap">
				<div class="block error-block">
					<div class="icon-note-wrap icon-note-wrap_error">{<PlaceholderNotFoundIconNode />}</div>
					<div class="info-wrap">
						<span class="error_text">{params.text}</span>
					</div>
					<button class="delete-btn" onclick={params.onRemove}>
						<PlaceholderDeleteIconNode />
					</button>
				</div>
			</div>
		);
	}
});
