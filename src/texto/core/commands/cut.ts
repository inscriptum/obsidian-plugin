import {TextSelection} from 'prosemirror-state';

import type {Command} from '../@types';

/**
 * @see https://github.com/ueberdosis/tiptap/blob/1c5c087641162dc9d82814aaa84fcdc267469545/packages/core/src/commands/cut.ts
 */
export function cut(originRange: {from: number; to: number}, targetPos: number): Command {
	return ({editor, tr}) => {
		const {state} = editor;

		const contentSlice = state.doc.slice(originRange.from, originRange.to);

		tr.deleteRange(originRange.from, originRange.to);
		const newPos = tr.mapping.map(targetPos);

		tr.insert(newPos, contentSlice.content);

		tr.setSelection(new TextSelection(tr.doc.resolve(newPos - 1)));

		return true;
	};
}
