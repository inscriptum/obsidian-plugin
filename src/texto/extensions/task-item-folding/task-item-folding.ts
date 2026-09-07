import { Extension } from '../../core';
import { addCommands } from './foldingCommands';
import {
  createTaskFoldingPlugin,
  getFoldedTaskPositions,
  restoreFoldedTasks,
  taskFoldingKey,
} from './taskFoldingPlugin';

export interface TaskItemFoldingOptions {
  /** Disable folding entirely (mobile, mirroring heading folding v1). */
  enabled: boolean;
}

export interface TaskItemFoldingStorage {
  /** Last known folded task item positions (updated on every transaction). */
  positions: number[];
}

declare module '../../core' {
  interface Commands<ReturnType> {
    taskItemFolding: {
      toggleTaskFold: (pos: number) => ReturnType
      foldTask: (pos: number) => ReturnType
      unfoldTask: (pos: number) => ReturnType
    }
  }
}

export const TaskItemFolding = Extension.create<
  TaskItemFoldingOptions,
  TaskItemFoldingStorage
>({
  name: 'taskItemFolding',

  addOptions() {
    return {
      enabled: true,
    };
  },

  addStorage() {
    return {
      positions: [],
    };
  },

  addCommands,

  onTransaction({ transaction }) {
    if (transaction.getMeta(taskFoldingKey) != null || transaction.docChanged) {
      this.storage.positions = getFoldedTaskPositions(this.editor.state);
    }
  },

  addProseMirrorPlugins() {
    if (!this.options.enabled) {
      return [];
    }

    return [
      createTaskFoldingPlugin({
        taskItemTypeName: 'taskItem',
      }),
    ];
  },
});

export { taskFoldingKey, getFoldedTaskPositions, restoreFoldedTasks };
export type { TaskSectionRange, TaskFoldingMeta, TaskFoldingState } from './taskFoldingPlugin';
