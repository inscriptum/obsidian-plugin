import {Node} from '../../core';
import {mergeAttributes} from '../../core/utilities';

export interface TitleOptions {
	HTMLAttributes: Record<string, any>;
}

export const NoteTitle = Node.create<TitleOptions>({
	name: 'noteTitle',

	content: 'inline*',

	defining: true,
	selectable: false,

	parseHTML() {
		return [
			{
				tag: 'h1',
			},
		];
	},

	renderHTML({HTMLAttributes}) {
		return ['h1', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
	},

	addKeyboardShortcuts() {
		return {
			Backspace: ({editor}) => {
				// Skip for a documents with more then 2 blocks
				if (this.editor.state.doc.childCount > 2) {
					return false;
				}

				const {empty, $anchor} = editor.state.selection;

				// Skip for non empty selections
				if (!empty) {
					return false;
				}

				const parentNodePos = $anchor.before(1);
				const parentNode = editor.state.doc.nodeAt(parentNodePos);
				const previousParentNodePos = editor.state.doc
					.resolve(parentNodePos < 1 ? 0 : parentNodePos - 1)
					.before(1);
				const previousParentNode = editor.state.doc.nodeAt(previousParentNodePos);

				// Replace Backspace if there are only two blocks (title and non title) and our cursor is between them
				if (
					previousParentNode?.type === this.type &&
					parentNode?.type !== this.type &&
					$anchor.depth === 1 &&
					$anchor.pos - $anchor.depth === parentNodePos
				) {
					this.editor.commands.insertContentAt(
						parentNodePos + (parentNode?.nodeSize || 0),
						{type: 'paragraph'},
						{updateSelection: false},
					);
					this.editor.commands.keyboardShortcut('Backspace');

					return true;
				}

				return false;
			},
		};
	},
});
