import type {Editor} from '../../../core';
import {find} from 'linkifyjs';
import type {MarkType} from 'prosemirror-model';
import {Plugin, PluginKey} from 'prosemirror-state';

type PasteHandlerOptions = {
	editor: Editor;
	type: MarkType;
};

export function pasteHandler(options: PasteHandlerOptions): Plugin {
	return new Plugin({
		key: new PluginKey('handlePasteLink'),
		props: {
			handlePaste: (view, event, slice) => {
				const {state} = view;
				const {selection} = state;
				const {empty} = selection;

				if (empty) {
					return false;
				}

				let textContent = '';

				slice.content.forEach((node) => {
					textContent += node.textContent;
				});

				const link = find(textContent).find((item) => item.isLink && item.value === textContent);

				if (!textContent || !link) {
					return false;
				}

				const html = event.clipboardData?.getData('text/html');

				const hrefRegex = /href="([^"]*)"/;

				const existingLink = html?.match(hrefRegex);

				const url = existingLink ? existingLink[1] : link.href;

				options.editor.commands.setMark(options.type, {
					href: url,
				});

				return true;
			},
		},
	});
}
