import type { EditorState } from 'prosemirror-state';
import type { KeyToPosValue } from '../attachment';

export function createPositions(_state: EditorState, pos: number): KeyToPosValue {
  return { pos };
}
