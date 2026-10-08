import type { Command } from "../../core/@types";
import type { AnyConfig } from "../../core/@types/AnyConfig";

type AddCommandsThis = ThisParameterType<Required<AnyConfig>["addCommands"]>;

/** Seed source of a freshly inserted block — small and valid. */
export const DEFAULT_MERMAID_SOURCE = [
  "flowchart LR",
  "  A[Insert] --> B{Mermaid}",
  "  B --> C[Edit]",
  "  B --> D[View]",
].join("\n");

/**
 * Insert a new mermaid diagram block with the example source; the caret
 * moves onto the block.
 */
function insertMermaid(this: AddCommandsThis): Command {
  return ({ commands }) => {
    return commands.insertContent(
      {
        type: this.name,
        attrs: {
          code: DEFAULT_MERMAID_SOURCE,
        },
      },
      {
        updateSelection: true,
      },
    );
  };
}

export function addCommands(this: AddCommandsThis) {
  return {
    insertMermaid: insertMermaid.bind(this),
  };
}
