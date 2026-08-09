import {getAttributes} from '../../../core';
import type {MarkType} from 'prosemirror-model';
import {Plugin, PluginKey} from 'prosemirror-state';

type ClickHandlerOptions = {
	type: MarkType;
};

export function clickHandler(options: ClickHandlerOptions): Plugin {
	return new Plugin({
		key: new PluginKey('handleClickLink'),
		props: {
			handleClick: (view, _, event) => {
				if (event.button !== 0) {
					return false;
				}

				const eventTarget = event.target as HTMLElement;

				if (eventTarget.nodeName !== 'A') {
					return false;
				}

				const attrs = getAttributes(view.state, options.type.name);
				const link = event.target as HTMLAnchorElement;

				const href = link?.href ?? attrs.href;
				const target = link?.target ?? attrs.target;

				if (link && href) {
					if (view.editable) {
						window.open(href, target, 'noopener');
					}

					return true;
				}

				return false;
			},
		},
	});
}
