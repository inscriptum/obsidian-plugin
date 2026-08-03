import type {Node as ProseMirrorNode} from 'prosemirror-model';
import {Selection, TextSelection} from 'prosemirror-state';

import type {FocusPosition} from '../@types';
import {minMax} from '../utilities/minMax';

export function resolveFocusPosition(doc: ProseMirrorNode, position: FocusPosition = null): Selection | null {
	if (!position) {
		return null;
	}

	const selectionAtStart = Selection.atStart(doc);
	const selectionAtEnd = Selection.atEnd(doc);

	if (position === 'start' || position === true) {
		return selectionAtStart;
	}

	if (position === 'end') {
		return selectionAtEnd;
	}

	if (position === 'secondLineStart') {
		const firstLineEnd = doc.content.firstChild?.nodeSize;

		if (typeof firstLineEnd !== 'number') {
			return null;
		}

		return TextSelection.create(doc, firstLineEnd + 1);
	}

	const minPos = selectionAtStart.from;
	const maxPos = selectionAtEnd.to;

	if (position === 'all') {
		return TextSelection.create(doc, minMax(0, minPos, maxPos), minMax(doc.content.size, minPos, maxPos));
	}

	return TextSelection.create(doc, minMax(position, minPos, maxPos), minMax(position, minPos, maxPos));
}
