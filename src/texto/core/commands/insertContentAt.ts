import {type Node as ProseMirrorNode, type ParseOptions,Fragment} from 'prosemirror-model';
import {ReplaceAroundStep, ReplaceStep} from 'prosemirror-transform';

import type {Command, Content, Range} from '../@types';
import {createNodeFromContent} from '../helpers/createNodeFromContent';
import {findParentNodeClosestToPos} from '../helpers/findParentNodeClosestToPos';
import {selectionToInsertionEnd} from '../helpers/selectionToInsertionEnd';

const isFragment = (nodeOrFragment: ProseMirrorNode | Fragment): nodeOrFragment is Fragment => {
	return nodeOrFragment.toString().startsWith('<');
};

/**
 * Insert a node or string of HTML at a specific position.
 */
export function insertContentAt(
	position: number | Range,
	value: Content,
	options?: {
		parseOptions?: ParseOptions;
		updateSelection?: boolean;
	},
): Command {
	// eslint-disable-next-line sonarjs/cognitive-complexity
	return ({tr, dispatch, editor}) => {
		if (dispatch) {
			options = {
				parseOptions: {},
				updateSelection: true,
				...options,
			};

			let content: ProseMirrorNode | Fragment = Fragment.empty;

			try {
				content = createNodeFromContent(value, editor.schema, {
					parseOptions: {
						preserveWhitespace: 'full',
						...options.parseOptions,
					},
				});
			} catch (error) {
				console.warn('[TEXTO WARN]: Invalid content.', 'Passed value:', content, 'Error:', error);
			}

			// don’t dispatch an empty fragment because this can lead to strange errors
			if (content.toString() === '<>') {
				return true;
			}

			let {from, to} = typeof position === 'number' ? {from: position, to: position} : position;

			let isOnlyTextContent = true;
			let isOnlyBlockContent = true;
			const nodes = isFragment(content) ? content : [content];

			nodes.forEach((node) => {
				// check if added node is valid
				node.check();

				isOnlyTextContent = isOnlyTextContent ? node.isText && node.marks.length === 0 : false;

				isOnlyBlockContent = isOnlyBlockContent ? node.isBlock : false;
			});

			// check if we can replace the wrapping node by
			// the newly inserted content
			// example:
			// replace an empty paragraph by an inserted image
			// instead of inserting the image below the paragraph
			if (from === to && isOnlyBlockContent) {
				const pos = tr.doc.resolve(from);
				const isCodeParent = findParentNodeClosestToPos(pos, (node) => !!node.type.spec.code) != null;
				const isEmptyTextBlock = pos.parent.isTextblock && !isCodeParent && !pos.parent.childCount;

				if (isEmptyTextBlock) {
					from -= 1;
					to += 1;
				}
			}

			// if there is only plain text we have to use `insertText`
			// because this will keep the current marks
			if (isOnlyTextContent) {
				tr.insertText(value as string, from, to);
			} else {
				tr.replaceWith(from, to, content);
			}

			// set cursor at the added content
			if (options.updateSelection) {
				let offset = 0;
				const lastStep = tr.steps[tr.steps.length - 1];
				if (
					(lastStep instanceof ReplaceStep || lastStep instanceof ReplaceAroundStep) &&
					!isFragment(content) &&
					lastStep.slice.content.lastChild !== content
				) {
					lastStep.slice.content.forEach((node, index) => {
						if (!isFragment(content) && node.type.name === content.type.name) {
							offset = index - lastStep.slice.content.childCount;
						}
					});
				}

				selectionToInsertionEnd(tr, tr.steps.length - 1, -1, offset);
			}
		}

		return true;
	};
}
