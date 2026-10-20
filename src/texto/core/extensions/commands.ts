import * as coreCommands from "../commands";
import { Extension } from "../Extension";

export const Commands = new Extension({
  name: "commands",

  addCommands() {
    return {
      ...coreCommands,
    };
  },
});

type CoreCommands = typeof coreCommands;

type CoreCommandsSet = {
  [P in keyof CoreCommands]: Record<P, CoreCommands[P]>;
};

declare global {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- declaration-merging augmentation point: global Commands interface gains this extension's commands; a type alias cannot merge into a global interface
  interface Commands extends CoreCommandsSet {}
}
