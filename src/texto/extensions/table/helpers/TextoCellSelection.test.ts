import type {Node as ProseMirrorNode} from 'prosemirror-model';
import {EditorState, TextSelection} from 'prosemirror-state';
import {CellSelection} from 'prosemirror-tables';
import type {DecorationSet} from 'prosemirror-view';
import {describe, expect, it} from 'vitest';

import {buildSchema} from '../../../../../tests/helpers/buildSchema';

import {createTable} from './createTable';
import {handleCellSelection} from './handleCellSelection';
import {TextoCellSelection} from './TextoCellSelection';

const schema = buildSchema();

function tableDoc(rows = 2, cols = 2): ProseMirrorNode {
	return createTable(schema, rows, cols, false);
}

function cellPositions(doc: ProseMirrorNode): number[] {
	const positions: number[] = [];
	doc.descendants((node, pos) => {
		if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
			positions.push(pos);
		}
		return true;
	});
	return positions;
}

describe('TextoCellSelection', () => {
	it('collapses the DOM-selection endpoints ($head === $anchor)', () => {
		const doc = tableDoc();
		const [p1, , , p4] = cellPositions(doc);
		const selection = new TextoCellSelection(doc.resolve(p1), doc.resolve(p4));

		expect(selection.$head.pos).toBe(selection.$anchor.pos);
		// The anchor stands at the start of the head cell's content.
		expect(selection.$anchor.pos).toBe(p4 + 1);
	});

	it('keeps cell ranges and $anchorCell/$headCell intact', () => {
		const doc = tableDoc();
		const [p1, , , p4] = cellPositions(doc);
		const selection = new TextoCellSelection(doc.resolve(p1), doc.resolve(p4));

		expect(selection.$anchorCell.pos).toBe(p1);
		expect(selection.$headCell.pos).toBe(p4);
		expect(selection.ranges).toHaveLength(4);
	});

	it('defaults $headCell to $anchorCell (single cell)', () => {
		const doc = tableDoc();
		const [p1] = cellPositions(doc);
		const selection = new TextoCellSelection(doc.resolve(p1));

		expect(selection.$headCell.pos).toBe(p1);
		expect(selection.$head.pos).toBe(selection.$anchor.pos);
		expect(selection.ranges).toHaveLength(1);
	});
});

describe('handleCellSelection appendTransaction', () => {
	it('normalizes a plain CellSelection to TextoCellSelection', () => {
		const doc = tableDoc();
		const [p1, , , p4] = cellPositions(doc);
		const plugin = handleCellSelection(false);
		const state = EditorState.create({doc, plugins: [plugin]});

		const next = state.apply(state.tr.setSelection(CellSelection.create(doc, p1, p4)));

		expect(next.selection).toBeInstanceOf(TextoCellSelection);
		expect(next.selection.$head.pos).toBe(next.selection.$anchor.pos);
		// The cell range is preserved.
		expect((next.selection as CellSelection).$anchorCell.pos).toBe(p1);
		expect((next.selection as CellSelection).$headCell.pos).toBe(p4);
	});

	it('keeps an already-normalized selection stable', () => {
		const doc = tableDoc();
		const [p1] = cellPositions(doc);
		const plugin = handleCellSelection(false);
		const state = EditorState.create({doc, plugins: [plugin]});

		const next = state.apply(state.tr.setSelection(new TextoCellSelection(doc.resolve(p1))));

		expect(next.selection).toBeInstanceOf(TextoCellSelection);
		expect(next.selection.$head.pos).toBe(next.selection.$anchor.pos);
	});
});

describe('resize handle decorations (mobile view)', () => {
	function decorations(isMobileView: boolean, selection: (doc: ProseMirrorNode) => TextSelection | CellSelection) {
		const doc = tableDoc();
		const plugin = handleCellSelection(isMobileView);
		const state = EditorState.create({doc, selection: selection(doc), plugins: [plugin]});
		const draw = plugin.spec.props?.decorations as ((state: EditorState) => DecorationSet) | undefined;
		const set = draw?.(state);
		return set ? set.find() : [];
	}

	const caretInFirstCell = (doc: ProseMirrorNode) => TextSelection.create(doc, cellPositions(doc)[0] + 1);

	it('renders only the overlay on desktop (caret in cell)', () => {
		expect(decorations(false, caretInFirstCell)).toHaveLength(1);
	});

	it('adds a resize handle per row segment on mobile (caret in cell)', () => {
		// 2x2: overlay + 2 handle segments (one per row).
		expect(decorations(true, caretInFirstCell)).toHaveLength(3);
	});

	it('adds resize handles next to the multi-cell overlay on mobile', () => {
		const cellRange = (doc: ProseMirrorNode) => {
			const [p1, , , p4] = cellPositions(doc);
			return CellSelection.create(doc, p1, p4);
		};

		// Overlay + 2 handle segments (the .selectedCell class is added by tableEditing).
		expect(decorations(true, cellRange)).toHaveLength(3);
	});
});
