import {Plugin, PluginKey} from 'prosemirror-state';

import {Extension} from '../Extension';
import {getFirstFromAndLastToPos} from '../helpers/getFirstFromAndLastToPos';
import {getTextBetween} from '../helpers/getTextBetween';
import {getTextSerializersFromSchema} from '../helpers/getTextSerializersFromSchema';

export const ClipboardTextSerializer = Extension.create({
	name: 'clipboardTextSerializer',

	addProseMirrorPlugins() {
		return [
			new Plugin({
				key: new PluginKey('clipboardTextSerializer'),
				props: {
					clipboardTextSerializer: () => {
						const {editor} = this;
						const {state, schema} = editor;
						const {doc, selection} = state;
						const {from, to} = getFirstFromAndLastToPos(selection.ranges);
						const textSerializers = getTextSerializersFromSchema(schema);
						const range = {from, to};

						return getTextBetween(doc, range, {
							textSerializers,
						});
					},
				},
			}),
		];
	},
});
