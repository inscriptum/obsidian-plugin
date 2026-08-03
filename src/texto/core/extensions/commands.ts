import * as coreCommands from '../commands';
import { Extension } from '../Extension';

export const Commands = new Extension({
  name: 'commands',

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
  interface Commands extends CoreCommandsSet {}
}
