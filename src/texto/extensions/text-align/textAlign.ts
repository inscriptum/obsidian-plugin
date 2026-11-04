import { Extension } from "../../core";
import type { Command } from "../../core/@types";

/**
 * Horizontal alignment of text blocks (issue text-align): left (the default,
 * stored as no attribute at all), center or right — like Word/Notion. The
 * owner rejected justify (2026-11-05).
 *
 * The attribute is global on paragraph and heading: every text block of the
 * schema IS one of these two (list items, task items and table cells hold
 * paragraphs), so one declaration covers them all. Left is the absence of
 * the attribute — pre-feature documents render and save exactly as before.
 *
 * The DOM projection is an inline text-align style on the block element:
 * it wins over the typography cascade without touching any stylesheet, and
 * the static-site export shows the same alignment for free.
 */

export type TextAlignValue = "center" | "right";

/** Block types that carry attrs.align (editor and export schemas). */
export const TEXT_ALIGN_TYPES = ["paragraph", "heading"];

interface TextAlignGlobalAttribute {
  default: null;
  renderHTML: (attributes: { align?: string | null }) => object;
  parseHTML: (element: HTMLElement) => string | null;
}

/** The attrs.align declaration shared by the editor extension and the export
 *  schema — without a declaration Node.fromJSON silently drops the attr. */
export function textAlignAttribute(): {
  types: string[];
  attributes: { align: TextAlignGlobalAttribute };
} {
  return {
    types: TEXT_ALIGN_TYPES,
    attributes: {
      align: {
        default: null,
        renderHTML: (attributes: { align?: string | null }) =>
          attributes.align == null
            ? {}
            : { style: `text-align: ${attributes.align}` },
        parseHTML: (element) => {
          const raw = element.style.textAlign;
          // Only the values the feature produces round-trip; everything
          // else (justify from foreign HTML, inherit, start…) is left.
          return raw === "center" || raw === "right" ? raw : null;
        },
      },
    },
  };
}

/** Attr-only piece for the export schema (it builds no editor, so it needs
 *  no commands) — same split as BlockIdAttributes. */
export const TextAlignAttributes = new Extension({
  name: "textAlignAttributes",
  addGlobalAttributes() {
    return [textAlignAttribute()];
  },
});

/** The editor piece: the same attr declaration plus the setTextAlign
 *  command. */
export const TextAlign = new Extension({
  name: "textAlign",
  addGlobalAttributes() {
    return [textAlignAttribute()];
  },
  addCommands() {
    return {
      setTextAlign:
        (align: TextAlignValue | "left"): Command =>
        ({ state, tr, dispatch }) => {
          const targetTypes = TEXT_ALIGN_TYPES.map(
            (name) => state.schema.nodes[name],
          ).filter(Boolean);
          const { from, to, empty } = state.selection;
          const positions: number[] = [];
          if (empty) {
            // A caret: the nearest paragraph/heading ancestor of the point.
            const $from = state.selection.$from;
            for (let d = $from.depth; d > 0; d--) {
              if (targetTypes.includes($from.node(d).type)) {
                positions.push($from.before(d));
                break;
              }
            }
          } else {
            // Every textblock spanned by the selection.
            state.doc.nodesBetween(from, to, (node, pos) => {
              if (targetTypes.includes(node.type) && node.isTextblock) {
                positions.push(pos);
                return false; // textblocks don't nest here
              }
              return true;
            });
          }
          if (positions.length === 0) return false;
          if (!dispatch) return true;
          // Toggle — but only when the selection is uniform: Word/Notion
          // apply the picked alignment to a mixed selection instead of
          // clearing it. Left is the attribute's absence — nothing new is
          // stored for it.
          const aligns = positions.map(
            (pos) =>
              (state.doc.nodeAt(pos)?.attrs as { align?: string | null })
                ?.align ?? null,
          );
          const uniform = aligns.every((a) => a === aligns[0]);
          const next =
            uniform && aligns[0] === align ? null : align === "left" ? null : align;
          for (const pos of positions) {
            const node = state.doc.nodeAt(pos);
            if (!node) continue;
            tr.setNodeMarkup(pos, undefined, {
              ...(node.attrs as Record<string, unknown>),
              align: next,
            });
          }
          return true;
        },
    };
  },
});
