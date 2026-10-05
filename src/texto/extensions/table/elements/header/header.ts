import { mergeAttributes, Node } from "../../../../core";
import type { AnyRecord } from "../../../../core/@types";
import {
  bordersFromStyle,
  bordersToStyle,
  type CellBorders,
} from "../../helpers/borders";
import { safeColorValue } from "../../helpers/safeStyle";

export interface TableHeaderOptions {
  HTMLAttributes: AnyRecord;
  initWidth: number;
}

export const TableHeader = Node.create<TableHeaderOptions>({
  name: "tableHeader",

  addOptions() {
    return {
      HTMLAttributes: {},
      initWidth: 50,
    };
  },

  // image allowed: a header cell can hold a picture as its block content
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
          // !important because the base cell color is !important. Stored
          // attrs are untrusted: only well-formed colors reach the style.
          const color = safeColorValue(attributes.dataColor);
          return color
            ? {
                ["data-color"]: attributes.dataColor,
                style: `color: ${color} !important`,
              }
            : { ["data-color"]: attributes.dataColor };
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
          // Stored attrs are untrusted (see the dataColor guard): only
          // well-formed colors reach the inline style.
          const color =
            attributes.backgroundColor == null
              ? null
              : safeColorValue(attributes.backgroundColor);
          if (!color) {
            return {};
          }

          return {
            style: `background-color: ${color} !important`,
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

  tableRole: "header_cell",

  isolating: true,

  parseHTML() {
    return [{ tag: "th" }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "th",
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
      0,
    ];
  },
});
