import type { CommandsSet } from "../../core/@types";
import type { addCommands } from "./foldingCommands";

export {
  TaskItemFolding,
  type TaskItemFoldingOptions,
  type TaskItemFoldingStorage,
} from "./task-item-folding";
export {
  taskFoldingKey,
  collectTaskSections,
  getFoldedTaskPositions,
  restoreFoldedTasks,
  TASK_FOLDING_CSS,
  type TaskSectionRange,
  type TaskFoldingMeta,
  type TaskFoldingState,
} from "./taskFoldingPlugin";

// Registers toggleTaskFold/foldTask/unfoldTask on the global Commands
// interface (same pattern as extensions/heading/index.ts), so
// editor.commands.toggleTaskFold(...) is fully typed.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- declaration-merging augmentation point: global Commands interface gains this extension's commands; a type alias cannot merge into a global interface
  interface Commands extends CommandsSet<ReturnType<typeof addCommands>> {}
}
