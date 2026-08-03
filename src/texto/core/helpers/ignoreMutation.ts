import {ios} from '../../utils/browser';

import type {Editor} from '../Editor';

type IgnoreMutationResult =
	| {
			wasProcessed: false;
	  }
	| {wasProcessed: true; value: boolean};

/**
 * Try to prevent a bug on iOS that will break node views on enter
 * this is because ProseMirror can’t preventDispatch on enter
 * this will lead to a re-render of the node view on enter
 *
 * @see: https://github.com/ProseMirror/prosemirror/issues/1162
 * @see: https://github.com/ueberdosis/tiptap/issues/1214
 * @see: https://github.com/ueberdosis/tiptap/pull/2170
 *
 * @param mutation - a current mutation
 * @param editor - an active editor
 * @param element - a DOM element from a NodeView
 *
 * @returns an object with flag wasProcessed is true if need to use a returned value
 */
export function ignoreMutationIOS(
	mutation: MutationRecord,
	editor: Editor,
	element: HTMLElement,
): IgnoreMutationResult {
	if (element.contains(mutation.target) && mutation.type === 'childList' && ios && editor.isFocused) {
		const changedNodes = [
			...Array.from(mutation.addedNodes),
			...Array.from(mutation.removedNodes),
		] as HTMLElement[];

		// we’ll check if every changed node is contentEditable
		// to make sure it’s probably mutated by ProseMirror
		if (changedNodes.every((node) => node.isContentEditable)) {
			return {
				wasProcessed: true,
				value: false,
			};
		}
	}

	return {
		wasProcessed: false,
	};
}
