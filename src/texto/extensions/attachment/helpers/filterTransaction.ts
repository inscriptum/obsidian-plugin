import type {Editor} from '../../../core';
import type {EditorState, PluginSpec, Transaction} from 'prosemirror-state';
import {ReplaceAroundStep, ReplaceStep} from 'prosemirror-transform';

import {keyToPos} from '../attachment';

const INNER_TRANSACTION_META = 'isInnerTask';

/**
 * Create a filterTransaction function to prevent attachment nodes to be deleted
 * @see https://github.com/ueberdosis/tiptap/issues/181
 *
 * @param attachmentNodeTypeName - attachment node type name
 * @returns - filterTransaction function
 */
export function getAttachmentFilterTransaction(editor: Editor): PluginSpec<unknown>['filterTransaction'] {
	return function (transaction) {
		const replaceSteps: number[] = [];

		// Analyze the current transaction if it's not an inner operation and without disabled history.
		// Just because we add 'addToHistory=false' for deterministic transactions, e.g. remove by click on a cross button
		if (!transaction.getMeta(INNER_TRANSACTION_META) && transaction.getMeta('addToHistory') !== false) {
			transaction.steps.forEach((step, index) => {
				if (step instanceof ReplaceStep) {
					replaceSteps.push(index);
				}

				if (step instanceof ReplaceAroundStep && step.slice.content.firstChild != null) {
					replaceSteps.push(index);
				}
			});
		}

		updateNodesPos(editor.state, transaction);

		return true; // true for keep, false for stop transaction
	};
}

/**
 * Actualize nodes' positions based on a transaction
 *
 * @param transaction - current transaction
 */
function updateNodesPos(_state: EditorState, transaction: Transaction) {
  if (transaction.steps.length > 0) {
    keyToPos.forEach((_position, key) => {
      const current = keyToPos.get(key);
      if (current) {
        keyToPos.set(key, { pos: transaction.mapping.map(current.pos) });
      }
    });
  }
}
