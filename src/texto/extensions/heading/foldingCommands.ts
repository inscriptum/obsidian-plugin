import type { Command } from '../../core/@types';
import type { AnyConfig } from '../../core/@types/AnyConfig';
import {
  findHeadingPos,
  headingFoldingKey,
  type HeadingFoldingMeta,
} from './foldingPlugin';

type AddCommandsThis = ThisParameterType<Required<AnyConfig>['addCommands']>;

export function addCommands(this: AddCommandsThis) {
  return {
    toggleHeadingFold:
      (pos?: number): Command =>
      ({ state, dispatch }) => {
        const headingPos =
          pos != null ? pos : findHeadingPos(state.selection.$anchor);

        if (headingPos == null || !isHeadingAt(state, headingPos)) {
          return false;
        }

        if (dispatch) {
          const meta: HeadingFoldingMeta = { type: 'toggle', pos: headingPos };
          dispatch(state.tr.setMeta(headingFoldingKey, meta));
        }

        return true;
      },

    foldHeading:
      (pos: number): Command =>
      ({ state, dispatch }) => {
        if (!isHeadingAt(state, pos)) {
          return false;
        }

        if (dispatch) {
          const meta: HeadingFoldingMeta = { type: 'fold', pos };
          dispatch(state.tr.setMeta(headingFoldingKey, meta));
        }

        return true;
      },

    unfoldHeading:
      (pos: number): Command =>
      ({ state, dispatch }) => {
        if (!isHeadingAt(state, pos)) {
          return false;
        }

        if (dispatch) {
          const meta: HeadingFoldingMeta = { type: 'unfold', pos };
          dispatch(state.tr.setMeta(headingFoldingKey, meta));
        }

        return true;
      },
  };
}

function isHeadingAt(
  state: Parameters<Command>[0]['state'],
  pos: number,
): boolean {
  const node = state.doc.nodeAt(pos);
  return node != null && node.type.name === 'heading';
}
