import {type Transaction,Selection} from 'prosemirror-state';
import {ReplaceAroundStep, ReplaceStep} from 'prosemirror-transform';

// source: https://github.com/ProseMirror/prosemirror-state/blob/master/src/selection.js#L466
export function selectionToInsertionEnd(tr: Transaction, startLen: number, bias: number, offset = 0) {
	const last = tr.steps.length - 1;

	if (last < startLen) {
		return;
	}

	const step = tr.steps[last];

	if (!(step instanceof ReplaceStep || step instanceof ReplaceAroundStep)) {
		return;
	}

	const map = tr.mapping.maps[last];
	let end: number | undefined;

	map.forEach((_from, _to, _newFrom, newTo) => {
		if (end == null) {
			end = newTo;
		}
	});

	if (typeof end === 'number') {
		tr.setSelection(Selection.near(tr.doc.resolve(end + offset), bias));
	}
}
