import {Editor} from '../../../core';
import {Plugin, PluginKey} from 'prosemirror-state';
import {Decoration, DecorationSet} from 'prosemirror-view';
import type { AnyRecord } from '../../../core/@types';

import {NoteTitle} from '../NoteTitle';

export interface NotePlaceholdersOptions {
	emptyTitleCssClassName?: string;
	emptyMainCssClassName?: string;
	emptyTitleTestId: string;
	emptyContentTestId: string;
	emptyParagraphTestId: string;
	placeholderTextTitle?: string;
	placeholderTextMain?: string;
	placeholderParagraph?: string;
	showOnlyWhenEditable?: boolean;
	showPlaceholderParagraph?: boolean;
}

export const notePlaceholdersPlugin = (
	editor: Editor,
	options: NotePlaceholdersOptions,
	notEmptyTitleAttributes: AnyRecord | undefined,
) =>
	new Plugin({
		key: new PluginKey('notePlaceholders'),
		state: {
			init(_config, state) {
				const {tr, doc} = editor.state;

				if (doc.content.size < 1) {
					tr.insert(0, editor.schema.node(NoteTitle.name));
					state.doc = editor.state.apply(tr).doc;
				}
			},
			apply: () => undefined,
		},
		props: {
			decorations: ({doc, selection}) => {
				const active = editor.isEditable || !options.showOnlyWhenEditable;

				if (!active || doc.content.size < 1) {
					return null;
				}

				const decorations: Decoration[] = [];
				const title = doc.content.child(0);
				const mainFirstLine = doc.content.child(1);

				if (title.content.size === 0) {
					decorations.push(
						Decoration.node(0, title.nodeSize, {
							class: options.emptyTitleCssClassName,
							'data-placeholder': options.placeholderTextTitle,
							'data-test-id': options.emptyTitleTestId,
						}),
					);
				} else {
					decorations.push(Decoration.node(0, title.nodeSize, {...notEmptyTitleAttributes}));
				}

				const isContentConsistsJustOfMainFirstLine = doc.content.lastChild === mainFirstLine;

				if (isContentConsistsJustOfMainFirstLine && mainFirstLine.content.size === 0) {
					decorations.push(
						Decoration.node(title.nodeSize, title.nodeSize + mainFirstLine.nodeSize, {
							class: options.emptyMainCssClassName,
							'data-placeholder': options.placeholderTextMain,
							'data-test-id': options.emptyContentTestId,
						}),
					);
				}

				const currentNode = selection.$anchor.node();
				const depth = selection.$anchor.depth;
				const size = currentNode.content.size;

				if (
					!isContentConsistsJustOfMainFirstLine &&
					options.showPlaceholderParagraph &&
					editor.isFocused &&
					depth === 1 &&
					size === 0 &&
					currentNode.type.name === 'paragraph'
				) {
					const pos = selection.$anchor.pos;

					decorations.push(
						Decoration.node(pos - 1, pos + currentNode.nodeSize - 1, {
							class: options.emptyMainCssClassName,
							'data-placeholder': options.placeholderParagraph,
							'data-test-id': options.emptyParagraphTestId,
						}),
					);
				}

				return DecorationSet.create(doc, decorations);
			},
		},
	});
