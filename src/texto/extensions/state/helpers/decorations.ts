import { Editor } from "../../../core";
import type { Node as ProseMirrorNode } from "prosemirror-model";
import { EditorState, Transaction } from "prosemirror-state";
import { Mapping } from "prosemirror-transform";
import { Decoration, DecorationAttrs, DecorationSet } from "prosemirror-view";

// ── Internal prosemirror-view types (not in public API) ──────────────
// Centralized here so inline `as any` casts are not repeated everywhere.

/** DecorationSet augmented with internal `local` and `children` arrays. */
export type InternalDecorationSet = DecorationSet & {
  local: Decoration[];
  children: (number | DecorationSet)[];
};

/** Decoration augmented with internal `map()` method and `type.attrs` + `type.valid()`. */
type InternalDecoration = Decoration & {
  map: (mapping: Mapping, offset: number, oldOffset?: number) => InternalDecoration | null;
  type: {
    attrs: DecorationAttrs;
    valid: (doc: ProseMirrorNode, deco: Decoration) => boolean;
  };
};
// ─────────────────────────────────────────────────────────────────────
/**
 * Create a new decoration for nodeState plugin with relative positions based on ySync plugin
 *
 * @param state - editor state
 * @param key - key attribute to use like id
 * @param from - start position
 * @param to - end position
 * @returns a new node decoration
 */
export function createNewDecorationWithRelativePositions(
  _state: EditorState,
  key: string,
  from: number,
  to: number,
) {
  return Decoration.node(from, to, { key }, { id: key });
}

/**
 * Add new decorations to a source decoration set based on current document and return a new decoration set
 *
 * @param doc - current document
 * @param decoSet - the source decoration set
 * @param newDecos - new decorations to add to the decoration set
 * @returns a new decoration set based on the source decoration set an new decorations
 */
export function addDecorationsToSet(
  doc: ProseMirrorNode,
  decoSet: DecorationSet,
  newDecos: Decoration[],
): DecorationSet {
  try {
    const newDecoSet = DecorationSet.create(
      doc,
      newDecos.slice(),
    ) as InternalDecorationSet;

    const isCanBeAddedToDoc =
      newDecoSet.local.length > 0 || newDecoSet.children.length > 0;

    if (!isCanBeAddedToDoc) {
      return decoSet;
    }

    // Filter decorations to remove duplicates
    newDecos.forEach((deco) => {
      // The default 'find' returns including decorations that start or end directly at the boundaries (see PM documentation)
      // So that we get all decorations in a set and filter them additionally
      const decosByPos = decoSet
        .find()
        .filter((it) => deco.from === it.from && deco.to === it.to);
      decoSet = decoSet.remove(decosByPos);
    });

    return decoSet.add(doc, newDecos);
  } catch {
    return decoSet;
  }
}

/**
 * Map the set of decorations in response to a change in the document.
 * It's a safety version of the standard set.map function that prevent removing decorations every time for setNodeMarkup operation.
 *
 * @see https://discuss.prosemirror.net/t/will-setnodemarkup-remove-decoration-at-same-pos/3111/4
 *
 * @param set - an origin set of decoration
 * @param tr - current transaction
 * @param onRemove - a callback for removing a decoration from the set
 *
 * @returns a new set of decorations
 */
export function mapSafetyNodeMarkup(
  this: Editor,
  set: DecorationSet,
  tr: Transaction,
  onRemove: (removedDeco: Decoration) => void,
) {
  let decorations: Decoration[] = [];

  // HACK: In common case we could use just:
  // 		set = set.map(tr.mapping, tr.doc)
  const s = set as InternalDecorationSet;
  s.local.forEach((deco) => {
    const mapped = (deco as InternalDecoration).map(tr.mapping, 0, 0);
    if (mapped?.type.valid(tr.doc, mapped)) {
      decorations.push(mapped);
    } else {
      decorations.push(deco);
    }
  });

  decorations = mapAndGatherDecorations(
    s.children,
    decorations,
    tr,
    0,
    0,
  );

  // Create a new DecorationSet for current doc from a list of decorations
  let newDecorationSet = DecorationSet.empty;
  decorations.forEach((newDeco) => {
    try {
      // For local transactions just use a new decorations without mapping positions because PM will actualise them by itself
      newDecorationSet = addDecorationsToSet(tr.doc, newDecorationSet, [
        newDeco,
      ]);
    } catch (error) {
      console.warn(
        "[TEXTO WARN]: Can not update a decoration set during mapping operation.",
        "Error:",
        error,
      );
    }
  });

  // Check if all decorations have been applied to the doc
  decorations.forEach((newDeco) => {
    // Check if all decorations have been applied to the doc
    const hasNewDecorationInSet =
      newDecorationSet.find(
        undefined,
        undefined,
        (spec: { id: string }) => spec.id === (newDeco.spec as { id: string }).id,
      ).length > 0;

    if (!hasNewDecorationInSet) {
      onRemove(newDeco);
    }
  });

  return newDecorationSet;
}

function mapAndGatherDecorations(
  children: (number | DecorationSet)[],
  decorations: Decoration[],
  tr: Transaction,
  offset: number,
  oldOffset: number,
) {
  const oldChildren = children.slice();

  // Gather all decorations from the children
  function gather(set: InternalDecorationSet, oldOffset: number) {
    for (let i = 0; i < set.local.length; i++) {
      // HACK: In common case we could just use:
      // 		set = set.map(tr.mapping, tr.doc)
      // but here we want to prevent removing decorations every time for setNodeMarkup operation
      const deco = set.local[i];
      const mapped = (deco as InternalDecoration).map(tr.mapping, offset, oldOffset);
      if (mapped != null) {
        decorations.push(mapped);
      } else {
        decorations.push(
          Decoration.node(
            deco.from + oldOffset,
            deco.to + oldOffset,
            { ...(deco as InternalDecoration).type.attrs },
            deco.spec,
          ),
        );
      }
    }

    for (let i = 0; i < set.children.length; i += 3) {
      gather(
        set.children[i + 2] as InternalDecorationSet,
        (set.children[i] as number) + oldOffset + 1,
      );
    }
  }

  for (let i = 0; i < children.length; i += 3) {
    gather(children[i + 2] as InternalDecorationSet, (oldChildren[i] as number) + oldOffset + 1);
  }

  return decorations;
}
