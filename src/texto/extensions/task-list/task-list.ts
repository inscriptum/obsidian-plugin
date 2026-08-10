import {mergeAttributes, Node} from '../../core';
import type { AnyRecord } from '../../core/@types';

import {addCommands} from './commands';

export interface TaskListOptions {
	itemTypeName: string;
	  HTMLAttributes: AnyRecord;
}

export const TaskList = Node.create<TaskListOptions>({
	name: 'taskList',

	selectable: false,

	addOptions() {
		return {
			itemTypeName: 'taskItem',
			HTMLAttributes: {},
		};
	},

	group: 'block list',

	content() {
		return `${this.options.itemTypeName}+`;
	},

	parseHTML() {
		return [
			{
				tag: `ul[data-type="${this.name}"]`,
				priority: 51,
			},
		];
	},

	renderHTML({HTMLAttributes}) {
		return [
			'ul',
			mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {'data-type': this.name}),
			0,
		];
	},

	addCommands,
	addKeyboardShortcuts() {
		return {
			'Mod-Shift-9': () => this.editor.commands.toggleTaskList(),
		};
	},
});
