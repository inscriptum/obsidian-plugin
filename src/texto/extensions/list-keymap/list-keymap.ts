import {Extension} from '../../core';

import {addCommands} from './commands';
import {handleBackspace} from './helpers/index';

export type ListKeymapOptions = {
	listTypes: Array<{
		itemName: string;
		wrapperNames: string[];
	}>;
};

export const ListKeymap = Extension.create<ListKeymapOptions>({
	name: 'listKeymap',

	addOptions() {
		return {
			listTypes: [
				{
					itemName: 'listItem',
					wrapperNames: ['bulletList', 'orderedList'],
				},
				{
					itemName: 'taskItem',
					wrapperNames: ['taskList'],
				},
			],
		};
	},

	addKeyboardShortcuts() {
		return {
			Backspace: ({editor}) => {
				let handled = false;

				this.options.listTypes.forEach(({itemName, wrapperNames}) => {
					if (editor.state.schema.nodes[itemName] === undefined) {
						return;
					}

					if (handleBackspace(editor, itemName, wrapperNames)) {
						handled = true;
					}
				});

				return handled;
			},
			// eslint-disable-next-line sonarjs/no-identical-functions
			'Mod-Backspace': ({editor}) => {
				let handled = false;

				// eslint-disable-next-line sonarjs/no-identical-functions
				this.options.listTypes.forEach(({itemName, wrapperNames}) => {
					if (editor.state.schema.nodes[itemName] === undefined) {
						return;
					}

					if (handleBackspace(editor, itemName, wrapperNames)) {
						handled = true;
					}
				});

				return handled;
			},
		};
	},

	addCommands,
});
