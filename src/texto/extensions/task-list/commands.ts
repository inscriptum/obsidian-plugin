import { NodeType } from "prosemirror-model";
import { Command } from "../../core/@types";
import { AnyConfig } from "../../core/@types/AnyConfig";

type AddCommandsThis = ThisParameterType<
  Required<AnyConfig<{ itemTypeName: string | NodeType }>>["addCommands"]
>;

function toggleTaskListOverride(this: AddCommandsThis): Command {
  return ({ commands }) => {
    return commands.toggleList(this.name, this.options.itemTypeName);
  };
}

export function addCommands(this: AddCommandsThis) {
  return {
    toggleTaskList: toggleTaskListOverride.bind(this),
  };
}
