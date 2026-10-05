import { mergeAttributes, Node } from "../../../../core";
import type { AnyRecord } from "../../../../core/@types";
import {
  bordersFromStyle,
  bordersToStyle,
  type CellBorders,
} from "../../helpers/borders";

export interface TableCellOptions {
  HTMLAttributes: AnyRecord;
  initWidth: number;
}

export const TableCell = Node.create<TableCellOptions>({
  name: "tableCell",

  addOptions() {
    return {
      HTMLAttributes: {},
      initWidth: 50,
    };
  },

  // image allowed: a cell can hold a picture as its block content
  // (schema-shape change → UM_SCHEMA_VERSION 2, see editorSchemas.test).
  content: "(block | image)+",

  addAttributes() {
    const initWidth = this.options.initWidth;
    return {
      colspan: {
        default: 1,
      },
      rowspan: {
        default: 1,
      },
      colwidth: {
        default: [initWidth],
        parseHTML: (element: HTMLElement) => {
          const colwidth = element.dataset["colwidth"];
          return colwidth ? [parseInt(colwidth)] : [initWidth];
        },
        renderHTML: (attributes: {
          colwidth: number[];
          dataColor: string | null;
          backgroundColor: string | null;
        }) => ({
          ["data-colwidth"]: attributes?.colwidth
            ? attributes.colwidth
            : [initWidth],
        }),
      },
      dataColor: {
        default: null,
        renderHTML: (attributes: {
          colwidth: number[];
          dataColor: string | null;
          backgroundColor: string | null;
        }) => {
          if (!attributes.dataColor) {
            return {};
          }

          // The picked color is applied as-is — one rendering path for
          // every color (owner decision: no theme-adaptive shades). Inline
          // !important because the base cell color is !important.
          return {
            ["data-color"]: attributes.dataColor,
            style: `color: ${attributes.dataColor} !important`,
          };
        },
        parseHTML: (element) => {
          const dataColor = element.dataset["color"];
          return dataColor ? [dataColor] : [];
        },
      },
      backgroundColor: {
        default: null,
        renderHTML: (attributes: {
          colwidth: number[];
          dataColor: string | null;
          backgroundColor: string | null;
        }) => {
          if (!attributes.backgroundColor) {
            return {};
          }

          return {
            style: `background-color: ${attributes.backgroundColor} !important`,
          };
        },
        parseHTML: (element) => {
          return element.style.backgroundColor;
        },
      },
      borders: {
        default: null,
        renderHTML: (attributes: { borders: CellBorders | null }) => {
          const style = bordersToStyle(attributes.borders);
          return style ? { style } : {};
        },
        parseHTML: (element: HTMLElement) => {
          return bordersFromStyle(element);
        },
      },
    };
  },

  tableRole: "cell",

  isolating: true,

  parseHTML() {
    return [{ tag: "td" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "td",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
      0,
    ];
  },
});
