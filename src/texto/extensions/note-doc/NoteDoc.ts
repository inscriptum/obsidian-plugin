import {Node} from '../../core';

import {NoteTitle, TitleOptions} from './NoteTitle';
import {NotePlaceholdersOptions, notePlaceholdersPlugin} from './plugins/notePlaceholders.plugin';

interface NoteDocOptions extends NotePlaceholdersOptions {
	titleOptions?: TitleOptions;
}

export const NoteDoc = Node.create<NoteDocOptions>({
	name: 'noteDoc',
	topNode: true,
	content: 'noteTitle (block | attachment | image)+',

	addOptions() {
		return {
			emptyTitleCssClassName: 'is-empty',
			emptyMainCssClassName: 'is-empty',
			emptyTitleTestId: 'editor-title-node-empty',
			emptyContentTestId: 'editor-content-node-empty',
			emptyParagraphTestId: 'editor-paragraph-node-empty',
			placeholderTextTitle: 'Title …',
			placeholderTextMain: 'Main content …',
			placeholderParagraph: 'Empty paragraph …',
			showOnlyWhenEditable: true,
			showPlaceholderParagraph: true,
		};
	},

	addExtensions() {
		return [NoteTitle.configure(this.options.titleOptions)];
	},

	addProseMirrorPlugins() {
		return [notePlaceholdersPlugin(this.editor, this.options, this.options.titleOptions?.HTMLAttributes)];
	},
});
