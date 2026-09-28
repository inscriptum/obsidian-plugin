import type { JsonNode } from "../helpers";

export function noteTitle(text = "Title"): JsonNode {
  return { type: "noteTitle", content: [{ type: "text", text }] };
}

export function noteDoc(...children: JsonNode[]): JsonNode {
  return { type: "noteDoc", content: [noteTitle(), ...children] };
}

export function p(text: string): JsonNode {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

export function heading(level: number, text: string): JsonNode {
  return {
    type: "heading",
    attrs: { level },
    content: [{ type: "text", text }],
  };
}

export interface TaskSpec {
  text: string;
  checked?: boolean;
  sub?: TaskSpec[];
}

export function taskList(items: TaskSpec[]): JsonNode {
  return {
    type: "taskList",
    content: items.map((item) => ({
      type: "taskItem",
      attrs: { checked: item.checked ?? false },
      content: [
        p(item.text),
        ...(item.sub != null && item.sub.length > 0 ? [taskList(item.sub)] : []),
      ],
    })),
  };
}

/** rows[0] becomes the header row (tableHeader), the rest tableCell. */
export function table(rows: string[][]): JsonNode {
  return {
    type: "table",
    content: rows.map((row, i) => ({
      type: "tableRow",
      content: row.map((text) => ({
        type: i === 0 ? "tableHeader" : "tableCell",
        content: text.length > 0 ? [p(text)] : [],
      })),
    })),
  };
}
