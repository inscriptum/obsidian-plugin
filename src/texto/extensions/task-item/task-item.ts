import {isFunction, mergeAttributes, Node, wrappingInputRule} from '../../core';
import type {Editor} from '../../core';
import {elTag} from '../../../tags';
import type {KeyboardShortcutCommand} from '../../core/@types/index';
import {ignoreMutationIOS} from '../../core/helpers';
import type {Node as ProseMirrorNode} from 'prosemirror-model';

import {itemElement} from './view/item.element';

type checkboxOn = string;
type checkboxOff = string;

export interface TaskItemOptions {
	nested: boolean;
	/** Whether subtask folding (chevron) is enabled — the TaskItemFolding
	 *  extension must be active for the toggle to have any effect. */
	taskFolding: boolean;
	HTMLAttributes: Record<string, string>;
	taskListTypeName: string;
	onReadOnlyChecked?: (node: ProseMirrorNode, checked: boolean) => boolean;
	checkboxIconLinks?: [checkboxOn, checkboxOff];
}

export const inputRegex = /^\s*(\[([( |x])?])\s$/;

/** Whether this item has nested content (subtasks) and shows a fold chevron.
 *  Gated on both `nested` (schema allows nested lists) and `taskFolding`
 *  (the folding plugin is active): without the plugin the chevron would
 *  render but its click would be a silent no-op. */
function isFoldableItem(options: TaskItemOptions, node: ProseMirrorNode): boolean {
	return options.nested && options.taskFolding && node.childCount > 1;
}

/** Dispatch the fold toggle for the item at the given position. The
 *  toggleTaskFold command validates that the position still points at a
 *  task item before dispatching the fold meta. */
function toggleFoldAt(editor: Editor, pos: number | undefined): boolean {
	return pos != null && editor.commands.toggleTaskFold(pos);
}

export const VIEW_TAG = elTag('texto-extension-task-item');
/** Static tag used in HTML serialization (clipboard/export) — stays version-independent. */
export const HTML_TAG = 'texto-extension-task-item';
export const ItemElement = itemElement(VIEW_TAG);

export const TaskItem = Node.create<TaskItemOptions>({
	name: 'taskItem',
	selectable: false,
	defining: true,

	addOptions() {
		return {
			nested: false,
			taskFolding: false,
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
			renderHTML: (attributes: { checked: boolean }) => ({
					'data-checked': attributes.checked,
				}),
			},
		};
	},

	parseHTML() {
		return [
			{
				tag: HTML_TAG,
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
		element.classList.add('texto-extension-task-item-host');
		const contentEl = createDiv();
		contentEl.classList.add('content');

		return ({node, HTMLAttributes, getPos, editor}) => {
			element.props = {
				checked: !!node.attrs.checked,
				content: contentEl,
				foldable: isFoldableItem(this.options, node),
				handleChevronClick: () => {
					if (editor.isEditable && isFunction(getPos)) {
						toggleFoldAt(editor, getPos());
					}
				},
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

			element.dataset.checked = String(node.attrs.checked);

			Object.entries(HTMLAttributes).forEach(([key, value]) => {
				element.setAttribute(key, value);
			});

			return {
				dom: element,
				contentDOM: contentEl,
				ignoreMutation: (mutation: MutationRecord) => {
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

					element.dataset.checked = String(updatedNode.attrs.checked);

					element.props = {
						...element.props,
						checked: !!updatedNode.attrs.checked,
						foldable: isFoldableItem(this.options, updatedNode),
					};

					return true;
				},
			};
		};
	},
});
