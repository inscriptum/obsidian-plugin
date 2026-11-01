import {
  type Node as ProseMirrorNode,
  type ParseOptions,
  Fragment,
} from "prosemirror-model";

import type { Command, Content } from "../@types";
import { createDocument } from "../helpers/createDocument";

/**
 * Replace the whole document with new content.
 *
 * `meta` lands on the replacement transaction as extra keys — callers that
 * replace content from OUTSIDE the editor (sync, disk reload) tag the batch
 * so transaction observers can tell an external swap from a paste.
 */
export function setContent(
  content: Content,
  emitUpdate = false,
  parseOptions: ParseOptions = {},
  meta: Record<string, unknown> = {},
): Command {
  return ({ tr, editor, dispatch }) => {
    const { doc } = tr;

    let document: Fragment | ProseMirrorNode = Fragment.empty;

    try {
      document = createDocument(content, editor.schema, parseOptions);
    } catch (error) {
      console.warn(
        "[TEXTO WARN]: Invalid content.",
        "Passed value:",
        content,
        "Error:",
        error,
      );
    }

    if (dispatch) {
      let next = tr.replaceWith(0, doc.content.size, document);
      next = next.setMeta("preventUpdate", !emitUpdate);
      for (const [key, value] of Object.entries(meta)) {
        next = next.setMeta(key, value);
      }
    }

    return true;
  };
}
