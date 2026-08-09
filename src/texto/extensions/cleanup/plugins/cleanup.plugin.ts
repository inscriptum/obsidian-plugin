import {Plugin, PluginKey} from 'prosemirror-state';

const PM_DATA_ATTR = 'data-pm-slice';
const SELECTOR_EXTERNAL_SPAN = `*:not([${PM_DATA_ATTR}]) > span`;

const cleanupPluginKey = new PluginKey('cleanup');
let parser: DOMParser | null = null;

export const cleanupPlugin = new Plugin({
	key: cleanupPluginKey,
	props: {
		transformPastedHTML(html) {
			if (parser == null) {
				parser = new DOMParser();
			}

			const pastedEl = parser.parseFromString(html, 'text/html');

			// If there is some ProseMirror data skip clean up operations and return HTML as is
			if (pastedEl.querySelector(`[${PM_DATA_ATTR}]`) != null) {
				return html;
			}

			const externalSpanEls = pastedEl.querySelectorAll(SELECTOR_EXTERNAL_SPAN);
			externalSpanEls.forEach((el) => {
				if (el.instanceOf(HTMLElement)) {
					el.removeAttribute('style');
				}
			});

			return pastedEl.body.innerHTML;
		},
	},
});
