import {isFunction, mergeAttributes, Node, wrappingInputRule} from '../../core';
import type {KeyboardShortcutCommand} from '../../core/@types/index';
import {ignoreMutationIOS} from '../../core/helpers';
import type {Node as ProseMirrorNode} from 'prosemirror-model';

import {itemElement} from './view/item.element';

type checkboxOn = string;
type checkboxOff = string;

export interface TaskItemOptions {
	nested: boolean;
	HTMLAttributes: Record<string, any>;
	taskListTypeName: string;
	onReadOnlyChecked?: (node: ProseMirrorNode, checked: boolean) => boolean;
	checkboxIconLinks?: [checkboxOn, checkboxOff];
}

export const inputRegex = /^\s*(\[([( |x])?])\s$/;

export const VIEW_TAG = 'texto-extension-task-item';
export const ItemElement = itemElement(VIEW_TAG);

export const TaskItem = Node.create<TaskItemOptions>({
	name: 'taskItem',
	selectable: false,
	defining: true,

	addOptions() {
		return {
			nested: false,
			HTMLAttributes: {},
			taskListTypeName: 'taskList',
		};
	},

	content() {
		return this.options.nested ? 'paragraph block*' : 'paragraph+';
	},

	addAttributes() {
		return {
			checked: {
				default: false,
				keepOnSplit: false,
				parseHTML: (element) => element.getAttribute('data-checked') === 'true',
				renderHTML: (attributes) => ({
					'data-checked': attributes.checked,
				}),
			},
		};
	},

	parseHTML() {
		return [
			{
				tag: VIEW_TAG,
				priority: 51,
			},
			{
				tag: `li[data-type="${this.name}"]`,
				priority: 51,
			},
		];
	},

	renderHTML({node, HTMLAttributes}) {
		return [
			'li',
			mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
				'data-type': this.name,
			}),
			[
				'label',
				[
					'input',
					{
						type: 'checkbox',
						checked: node.attrs.checked ? 'checked' : null,
					},
				],
				['span'],
			],
			['div', 0],
		];
	},

	addKeyboardShortcuts() {
		const shortcuts: {
			[key: string]: KeyboardShortcutCommand;
		} = {
			Enter: () => this.editor.commands.splitListItem(this.name),
			'Shift-Tab': () => this.editor.commands.liftListItem(this.name),
		};

		if (!this.options.nested) {
			return shortcuts;
		}

		return {
			...shortcuts,
			Tab: () => this.editor.commands.sinkListItem(this.name),
		};
	},

	addInputRules() {
		return [
			wrappingInputRule({
				find: inputRegex,
				type: this.type,
				getAttributes: (match) => ({
					checked: match[match.length - 1] === 'x',
				}),
			}),
		];
	},

	addNodeView() {
		const element = new ItemElement();
		const contentEl = createDiv();
		contentEl.classList.add('content');

		return ({node, HTMLAttributes, getPos, editor}) => {
			element.props = {
				checked: !!node.attrs.checked,
				content: contentEl,
				editor,
				options: this.options,
				handleCheckboxClick: (checkboxEl) => {
					const {checked} = checkboxEl;

					if (editor.isEditable && isFunction(getPos)) {
						editor.commands.command(({tr}) => {
							const position = getPos();
							const currentNode = tr.doc.nodeAt(position);

							tr.setNodeMarkup(position, this.type, {
								...currentNode?.attrs,
								checked,
							});

							return true;
						});
					}

					if (
						!editor.isEditable &&
						this.options.onReadOnlyChecked &&
						!this.options.onReadOnlyChecked(node, checked)
					) {
						checkboxEl.checked = !checkboxEl.checked;
					}
				},
			};

			Object.entries(this.options.HTMLAttributes).forEach(([key, value]) => {
				element.setAttribute(key, value);
			});

			element.dataset.checked = node.attrs.checked;

			Object.entries(HTMLAttributes).forEach(([key, value]) => {
				element.setAttribute(key, value);
			});

			return {
				dom: element,
				contentDOM: contentEl,
				ignoreMutation: (mutation: any) => {
					const ignoreMutationIOsResult = ignoreMutationIOS(mutation, this.editor, element);

					if (ignoreMutationIOsResult.wasProcessed) {
						return ignoreMutationIOsResult.value;
					}

					if (mutation.target === element || element.contains(mutation.target)) {
						// Ignore mutations for our container because we control it's view by ourselves.
						// Additionally, in mobile Chrome browser mutations with container lead to a bug with an extra line.
						return true;
					}

					return false;
				},
				update: (updatedNode) => {
					if (updatedNode.type !== this.type) {
						return false;
					}

					element.dataset.checked = updatedNode.attrs.checked;

					element.props = {
						...element.props,
						checked: updatedNode.attrs.checked,
					};

					return true;
				},
			};
		};
	},
});
