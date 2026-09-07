import type { Command } from '../../core/@types';
import type { AnyConfig } from '../../core/@types/AnyConfig';
import {
  taskFoldingKey,
  type TaskFoldingMeta,
} from './taskFoldingPlugin';

type AddCommandsThis = ThisParameterType<Required<AnyConfig>['addCommands']>;

export function addCommands(this: AddCommandsThis) {
  return {
    toggleTaskFold:
      (pos: number): Command =>
      ({ state, dispatch }) => {
        if (!isTaskItemAt(state, pos)) {
          return false;
        }

        if (dispatch) {
          const meta: TaskFoldingMeta = { type: 'toggle', pos };
          dispatch(state.tr.setMeta(taskFoldingKey, meta));
        }

        return true;
      },

    foldTask:
      (pos: number): Command =>
      ({ state, dispatch }) => {
        if (!isTaskItemAt(state, pos)) {
          return false;
        }

        if (dispatch) {
          const meta: TaskFoldingMeta = { type: 'fold', pos };
          dispatch(state.tr.setMeta(taskFoldingKey, meta));
        }

        return true;
      },

    unfoldTask:
      (pos: number): Command =>
      ({ state, dispatch }) => {
        if (!isTaskItemAt(state, pos)) {
          return false;
        }

        if (dispatch) {
          const meta: TaskFoldingMeta = { type: 'unfold', pos };
          dispatch(state.tr.setMeta(taskFoldingKey, meta));
        }

        return true;
      },
  };
}

function isTaskItemAt(
  state: Parameters<Command>[0]['state'],
  pos: number,
): boolean {
  const node = state.doc.nodeAt(pos);
  return node != null && node.type.name === 'taskItem';
}
