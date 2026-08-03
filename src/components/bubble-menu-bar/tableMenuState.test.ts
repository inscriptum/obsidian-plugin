import { describe, it, expect } from 'vitest';
import { EditorState, TextSelection } from 'prosemirror-state';
import { CellSelection } from 'prosemirror-tables';
import { buildSchema } from '../../../tests/helpers/buildSchema';
import { createTable } from '../../texto/extensions/table/helpers/createTable';
import { bgHexToAttr, getTableMenuState, TABLE_BG_RGBA } from './tableMenuState';

const schema = buildSchema();

/** Позиции всех ячеек таблицы. */
function cellPositions(doc: any): number[] {
  const positions: number[] = [];
  doc.descendants((node: any, pos: number) => {
    if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
      positions.push(pos);
    }
    return true;
  });
  return positions;
}

function caretState(doc: any, atCell: number) {
  return EditorState.create({
    doc,
    selection: TextSelection.create(doc, atCell + 1),
  });
}

describe('getTableMenuState', () => {
  it('reports not-in-table for a plain paragraph', () => {
    const doc = schema.nodes.paragraph.create(null, schema.text('hello'));
    const state = EditorState.create({ doc, selection: TextSelection.create(doc, 1) });
    expect(getTableMenuState(state)).toEqual({
      inTable: false,
      multiCell: false,
      mergedCell: false,
      headerRow: false,
      bg: null,
      textColor: null,
    });
  });

  it('detects caret inside a table cell', () => {
    const table = createTable(schema, 2, 2, false);
    const [p1] = cellPositions(table);
    const state = caretState(table, p1);
    const s = getTableMenuState(state);
    expect(s.inTable).toBe(true);
    expect(s.multiCell).toBe(false);
    expect(s.mergedCell).toBe(false);
  });

  it('detects multi-cell selection (merge enabled)', () => {
    const table = createTable(schema, 2, 2, false);
    const [p1, , , p4] = cellPositions(table);
    const state = EditorState.create({ doc: table, selection: CellSelection.create(table, p1, p4) });
    const s = getTableMenuState(state);
    expect(s.inTable).toBe(true);
    expect(s.multiCell).toBe(true);
  });

  it('detects merged cell (split enabled)', () => {
    const table = createTable(schema, 2, 2, false);
    const [p1] = cellPositions(table);
    const mergedDoc = EditorState.create({ doc: table }).tr
      .setNodeMarkup(p1, null, { colspan: 2, rowspan: 1 })
      .doc;
    const state = caretState(mergedDoc, p1);
    const s = getTableMenuState(state);
    expect(s.mergedCell).toBe(true);
  });

  it('detects header row only when created with header', () => {
    const withHeader = createTable(schema, 2, 2, true);
    const [p1] = cellPositions(withHeader);
    expect(getTableMenuState(caretState(withHeader, p1)).headerRow).toBe(true);

    const withoutHeader = createTable(schema, 2, 2, false);
    const [p2] = cellPositions(withoutHeader);
    expect(getTableMenuState(caretState(withoutHeader, p2)).headerRow).toBe(false);
  });

  it('reads backgroundColor and dataColor attrs', () => {
    const table = createTable(schema, 2, 2, false);
    const [p1] = cellPositions(table);
    const doc = EditorState.create({ doc: table }).tr
      .setNodeMarkup(p1, null, { backgroundColor: 'rgba(74,222,128,.14)', dataColor: '#4ade80' })
      .doc;
    const s = getTableMenuState(caretState(doc, p1));
    expect(s.bg).toBe('rgba(74,222,128,.14)');
    expect(s.textColor).toBe('#4ade80');
  });
});

describe('TABLE_BG_RGBA / bgHexToAttr', () => {
  it('maps palette hex to the design semi-transparent fill', () => {
    expect(bgHexToAttr('#4ade80')).toBe('rgba(74, 222, 128, .14)');
    expect(bgHexToAttr(null)).toBe(null);
  });

  it('keeps unknown values as-is', () => {
    expect(bgHexToAttr('custom-color')).toBe('custom-color');
  });

  it('has an entry for every fill', () => {
    expect(Object.keys(TABLE_BG_RGBA)).toHaveLength(4);
  });
});
