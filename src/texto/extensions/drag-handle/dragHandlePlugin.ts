import type { Node as PMNode } from "prosemirror-model";
import { dropPoint } from "prosemirror-transform";
import {
  NodeSelection,
  Plugin,
  PluginKey,
  Selection,
  type EditorState,
  type Transaction,
} from "prosemirror-state";
import { Decoration, DecorationSet, type EditorView } from "prosemirror-view";
import {
  collectHeadingSections,
  headingFoldingKey,
  type HeadingFoldingMeta,
  type HeadingSectionRange,
} from "../heading/foldingPlugin";
import {
  taskFoldingKey,
  type TaskFoldingMeta,
} from "../task-item-folding/taskFoldingPlugin";

/**
 * Block drag & drop — a floating drag handle for top-level blocks.
 *
 * Concepts from tiptap's drag-handle (one floating handle positioned at the
 * block under the cursor), but WITHOUT the native HTML5 drag-and-drop: the
 * source element lives outside the contenteditable (so ProseMirror must not
 * observe it), and Electron's native drag loop proved unreliable for such
 * sources (a drag starts in the OS layer, but dragover/drop never reach the
 * renderer). Instead the drag is driven with pointer events — like Notion's
 * block handle — and the move applies the SAME steps as ProseMirror's
 * default drop handler (editHandlers.drop): snap the position with
 * `dropPoint`, delete the source selection, insert the slice, set the
 * selection after the inserted node (see performBlockMove).
 *
 * Draggable units (Notion-like):
 *  - list items (listItem / taskItem) drag INDIVIDUALLY — dropping an item
 *    between items of another list inserts it there (dropPoint), dropping
 *    it onto the doc level wraps it into a new list (dropPoint pass 2);
 *    a source list emptied by the move disappears (deleteRange trims it);
 *  - everything else drags as the whole top-level block;
 *  - a COLLAPSED heading drags together with its (hidden) section body —
 *    folding is decoration-based (the doc is never mutated, see
 *    heading/foldingPlugin.ts), so a section's body is ordinary sibling
 *    content and must be included in the move manually (expandThroughFolds).
 *    Task item bodies live INSIDE the item node, so they move with it
 *    automatically; their fold positions are re-seated by the move
 *    (remapFoldsAfterMove) — plain position mapping cannot follow content
 *    that is deleted and re-inserted elsewhere.
 *
 * Drop indicator: while dragging, the plugin draws a thin line at the
 * snapped insertion position via a widget decoration (the canonical
 * prosemirror-dropcursor draws its block indicator the same way, but it
 * only listens to native dragover events, which never fire here).
 *
 * DOM notes: the handle is appended to the editor's scroll container
 * (`view.dom.parentElement`, the .texto-editor article), NOT inside
 * `view.dom` — ProseMirror must not observe foreign nodes. The container
 * gets `position: relative` (styles/drag-handle.css) and the handle is
 * positioned in content coordinates, so it scrolls glued to its block.
 *
 * Hover model (geometric, no sticky zones and no promotions): the hovered
 * unit is the DEEPEST top-level block / list item whose vertical extent
 * contains the pointer Y. The whole strip left of a unit's content (the
 * gutter, however far left) belongs to that unit — the X coordinate never
 * participates in the resolution. Handles are rendered from a small pool
 * (several are visible at once):
 *  - one dots handle for the hovered unit — skipped when the unit's fold
 *    chevron is its grab point (the chevron is force-revealed instead);
 *  - one WHOLE-LIST handle per enclosing list, always visible while the
 *    pointer is within the list: glued to the first item's line, one slot
 *    left of the first item's own handle — grabbing it moves every item.
 *
 * Chevron interplay (headings, foldable task items): the chevron IS the
 * gutter control there — a quick click folds/unfolds (the browser's own
 * click), pressing and holding (~150ms) swaps the dots handle in the
 * chevron's place (grab look), and moving from there drags the unit.
 *
 * Gutter note: PM's posAtCoords returns null for coordinates left of the
 * editor content (the gutter where the handles live) — the Y-based hover
 * resolution above works there natively, no posAtCoords involved.
 */

export const dragHandleKey = new PluginKey<DragHandleState>(
  "inscriptumDragHandle",
);

/** Top-level node kinds that cannot be dragged (the document title). */
export const DRAG_HANDLE_EXCLUDED_TYPES: readonly string[] = ["noteTitle"];

/** Node kinds that drag as individual items (a whole list drags item-wise). */
export const DRAG_HANDLE_ITEM_TYPES: readonly string[] = [
  "listItem",
  "taskItem",
];

/** CSS classes (see styles/drag-handle.css). */
export const DRAG_HANDLE_CSS = {
  handle: "texto-drag-handle",
  visible: "is-visible",
  dragging: "is-dragging",
  /** Drop indicator widget class (line between blocks). */
  dropLine: "texto-drag-drop-line",
  /** Outline class on the dragged unit while moving. */
  dragSource: "texto-drag-source",
  /** Left-gutter fold chevrons that double as drag grab points: a quick
   *  click folds, pressing and holding swaps the dots handle in, moving
   *  from there drags (see createDragHandleView). On plain hover these
   *  blocks get NO dots handle — the chevron IS the handle there, and it
   *  is force-revealed with chevronHover when the unit is hovered from
   *  the gutter (where the block's own :hover rules don't reach). */
  gutterControls: [
    "texto-heading-fold-chevron-host",
    "texto-task-fold-chevron",
  ],
  /** Class toggled on a fold chevron: `is-hover` — the unit is hovered
   *  (force-reveals the chevron); `is-grabbed` — pressed and held past
   *  the hold window (the dots handle takes its place); `is-dragging` —
   *  armed drag. */
  chevronHover: "is-hover",
  chevronGrabbed: "is-grabbed",
  chevronDragging: "is-dragging",
} as const;

/** Handle geometry — mirrored in styles/drag-handle.css. */
const HANDLE_WIDTH = 24;
/** Gap between the handle and the unit's gutter chrome (fold chevron). */
const HANDLE_GAP = 2;
/** Minimum handle height (the first-line caret rect on paragraphs is ~19px). */
const HANDLE_MIN_HEIGHT = 28;
/** Fallback line height for units whose first line cannot be measured. */
const HANDLE_DEFAULT_HEIGHT = 24;
/** Vertical tolerance when matching a pointer line to a hovered unit (px). */
const LINE_STICKY_TOLERANCE = 6;
/** Pointer movement (px) after pointerdown that counts as a drag start. */
const DRAG_START_THRESHOLD = 3;

export interface DraggableBlock {
  node: PMNode;
  from: number;
  to: number;
}

/**
 * First text position inside a unit: for list/task items the caret at the
 * unit start is degenerate (their label/checkbox is contenteditable=false,
 * coordsAtPos there returns a zero-height rect), so resolve the first
 * paragraph's inner position instead.
 */
function firstTextPos(block: DraggableBlock): number | null {
  const children = block.node.content?.content;
  const first = children?.find((n) => n.type.name === "paragraph");
  if (children == null || first == null) {
    return null;
  }
  const offset = children
    .slice(0, children.indexOf(first))
    .reduce((s, n) => s + n.nodeSize, 0);
  // inside the paragraph, at its content start
  return block.from + 1 + offset + 1;
}

/** The closest item-type ancestor of the position, if any (list/task items). */
function findItemAncestor(
  doc: PMNode,
  pos: number,
): { node: PMNode; from: number } | null {
  const $pos = doc.resolve(pos);
  for (let depth = $pos.depth; depth >= 1; depth -= 1) {
    const node = $pos.node(depth);
    if (DRAG_HANDLE_ITEM_TYPES.includes(node.type.name)) {
      return { node, from: $pos.before(depth) };
    }
  }
  return null;
}

interface FoldedHeadingInfo {
  block: DraggableBlock;
  /** Doc range of the collapsed section (heading + hidden body). */
  range: { from: number; to: number };
  section: HeadingSectionRange;
}

/** The collapsed heading section that CONTAINS `pos` (pos inside the
 *  heading or inside its hidden body), null when no fold covers it.
 *  Heading folding is decoration-based, so from the drag plugin's view a
 *  collapsed section is state in headingFoldingKey plus a doc range. */
function foldedHeadingAt(
  doc: PMNode,
  folded: Set<number> | undefined,
  pos: number,
  excludedTypes: readonly string[],
): FoldedHeadingInfo | null {
  if (folded == null || folded.size === 0) {
    return null;
  }
  for (const section of collectHeadingSections(doc, "heading")) {
    if (!folded.has(section.headingPos)) {
      continue;
    }
    const from = section.headingPos;
    const to = section.body != null ? section.body.to : section.headingEnd;
    if (pos >= from && pos <= to) {
      const node = doc.nodeAt(from);
      if (node == null || excludedTypes.includes(node.type.name)) {
        return null;
      }
      return {
        block: { node, from, to: from + node.nodeSize },
        range: { from, to },
        section,
      };
    }
  }
  return null;
}

/** Extend a resolved unit through collapsed regions so the whole visible
 *  unit moves as one:
 *  - a folded heading extends to its section body end (the body is
 *    sibling content hidden by decorations — see heading/foldingPlugin.ts);
 *  - a unit inside another heading's collapsed body extends up to that
 *    section's range; dragging a hidden block must carry its whole section
 *    (the visible unit is the folded heading).
 *
 * `node` stays the section's heading: the dragged unit is identified by
 * what the user sees and grabs (the collapsed heading), while `from`/`to`
 * cover the full range that must move. */
function expandThroughFolds(
  doc: PMNode,
  folded: Set<number> | undefined,
  block: DraggableBlock,
  excludedTypes: readonly string[],
): DraggableBlock {
  const info = foldedHeadingAt(doc, folded, block.from, excludedTypes);
  if (info == null) {
    return block;
  }
  // block.from is inside the collapsed section: whether it is the folded
  // heading itself or a block of its hidden body, the whole section is the
  // draggable unit (the heading is what the user sees and grabs).
  return { node: info.block.node, from: info.range.from, to: info.range.to };
}

/** The collapsed heading section covering `pos` as a plain range, for the
 *  gutter lookup: null when no fold covers the position; `headingPos` is
 *  the section's heading start, `from`/`to` the full section range. */
function collapsedHeadingRange(
  doc: PMNode,
  folded: Set<number> | undefined,
  pos: number,
): { headingPos: number; from: number; to: number } | null {
  if (folded == null || folded.size === 0) {
    return null;
  }
  for (const section of collectHeadingSections(doc, "heading")) {
    if (!folded.has(section.headingPos)) {
      continue;
    }
    const from = section.headingPos;
    const to = section.body != null ? section.body.to : section.headingEnd;
    if (pos >= from && pos < to) {
      return { headingPos: from, from, to };
    }
  }
  return null;
}

/**
 * The draggable unit at the given doc position:
 *  - a position inside a list/task item resolves to that individual item;
 *  - any other nested structure (table cell, blockquote) resolves up to
 *    the whole top-level block;
 *  - a position on the border between two top-level blocks picks the
 *    following one (or the last block at doc end);
 *  - a collapsed heading (or a position inside its hidden body) resolves
 *    to the whole section: the heading plus the hidden body move together.
 */
export function findDraggableBlock(
  doc: PMNode,
  pos: number,
  excludedTypes: readonly string[] = DRAG_HANDLE_EXCLUDED_TYPES,
  state?: EditorState,
): DraggableBlock | null {
  if (pos < 0 || pos > doc.content.size) {
    return null;
  }

  // A collapsed heading section owns every position it covers — check
  // BEFORE the general resolution, which would otherwise pick an inner
  // block of the hidden body.
  if (state != null) {
    const folded = foldedHeadingAt(
      doc,
      headingFoldingKey.getState(state)?.folded,
      pos,
      excludedTypes,
    );
    if (folded != null) {
      return {
        node: folded.block.node,
        from: folded.range.from,
        to: folded.range.to,
      };
    }
  }

  const $pos = doc.resolve(pos);
  let from: number;

  if ($pos.depth === 0) {
    // Border between top-level blocks (or doc start/end).
    if ($pos.nodeAfter) {
      from = pos;
    } else if ($pos.nodeBefore) {
      from = pos - $pos.nodeBefore.nodeSize;
    } else {
      return null;
    }
  } else {
    const item = findItemAncestor(doc, pos);
    if (item != null) {
      from = item.from;
    } else {
      from = $pos.before(1);
    }
  }

  const node = doc.nodeAt(from);
  if (node == null || excludedTypes.includes(node.type.name)) {
    return null;
  }

  const block: DraggableBlock = { node, from, to: from + node.nodeSize };
  if (state == null) {
    return block;
  }
  return expandThroughFolds(
    doc,
    headingFoldingKey.getState(state)?.folded,
    block,
    excludedTypes,
  );
}

export interface DragHandleState {
  /** Active drag; null when idle. */
  drag: {
    block: DraggableBlock;
    /** Snapped insertion position (doc coordinates) or null. */
    insertPos: number | null;
  } | null;
}

type DragHandleMeta =
  | { type: "dragStart"; block: DraggableBlock }
  | { type: "dragMove"; insertPos: number | null }
  | { type: "dragEnd" };

/**
 * Begin a pointer-driven drag of an already resolved unit (the handle's
 * hovered block). Kept for programmatic use/tests; the pointer flow lives
 * in createDragHandleView.
 */
export function startDragWithBlock(
  view: EditorView,
  block: DraggableBlock,
): boolean {
  const { from } = block;

  // The doc may have changed since the block was resolved on hover.
  const node = view.state.doc.nodeAt(from);
  if (node == null || !node.eq(block.node)) {
    return false;
  }

  view.dispatch(
    view.state.tr
      .setMeta(dragHandleKey, {
        type: "dragStart",
        block,
      } satisfies DragHandleMeta)
      .setSelection(NodeSelection.create(view.state.doc, from))
      .setMeta("addToHistory", false),
  );
  return true;
}

/** Re-seat fold state for a finished block move — delete + re-insert
 *  defeats the folding plugins' position mapping (a fold at the vacated
 *  position would silently transfer onto whatever node lands there, and
 *  folds inside the moved unit would be lost). Runs against the move
 *  transaction's FINAL doc:
 *  - folds inside the dragged unit follow it to its new location, anchored
 *    by finding the moved unit in tr.doc (wrapping — an item dropped at the
 *    doc level lands inside a new list — shifts the anchor by ±1);
 *  - all other folds map through the transaction normally.
 *  Returns the metas to attach to the SAME transaction (setFolds), or null
 *  when there is nothing to fix. */
function buildFoldRemapMetas(
  state: EditorState,
  tr: Transaction,
  block: DraggableBlock,
  insertPos: number,
): { heading: HeadingFoldingMeta; task: TaskFoldingMeta } | null {
  const headingFolds = headingFoldingKey.getState(state)?.folded;
  const taskFolds = taskFoldingKey.getState(state)?.folded;
  if (
    (headingFolds == null || headingFolds.size === 0) &&
    (taskFolds == null || taskFolds.size === 0)
  ) {
    return null;
  }

  // Find the moved unit in tr.doc: the slice's first node, searched in the
  // insertion neighborhood (+2: a wrapper node may have been added).
  const first = block.node;
  let anchor: number | null = null;
  const searchEnd = Math.min(
    insertPos + block.to - block.from + 2,
    tr.doc.content.size,
  );
  if (insertPos <= tr.doc.content.size) {
    tr.doc.nodesBetween(insertPos, searchEnd, (node, pos) => {
      if (anchor == null && node.eq(first)) {
        anchor = pos;
      }
      return anchor == null;
    });
  }

  const headingNext = new Set<number>();
  const taskNext = new Set<number>();
  const seat = (folds: Set<number>, next: Set<number>) => {
    for (const pos of folds) {
      if (pos >= block.from && pos < block.to) {
        if (anchor != null) {
          next.add(anchor + (pos - block.from));
        }
        continue;
      }
      const result = tr.mapping.mapResult(pos);
      if (!result.deleted) {
        next.add(result.pos);
      }
    }
  };
  if (headingFolds != null) seat(headingFolds, headingNext);
  if (taskFolds != null) seat(taskFolds, taskNext);

  return {
    heading: { type: "setFolds", positions: Array.from(headingNext) },
    task: { type: "setFolds", positions: Array.from(taskNext) },
  };
}

/**
 * Apply the block move — the same steps as ProseMirror's default drop
 * (editHandlers.drop): snap with dropPoint, delete the source range,
 * insert the slice at the mapped position, then set the selection to the
 * inserted node. The move carries fold state along (buildFoldRemapMetas).
 */
export function performBlockMove(
  view: EditorView,
  block: DraggableBlock,
  insertPos: number,
): boolean {
  const doc = view.state.doc;
  const node = doc.nodeAt(block.from);
  if (node == null || !node.eq(block.node)) {
    return false;
  }

  const slice = doc.slice(block.from, block.to);
  const tr = view.state.tr;

  // Move semantics (like `view.dragging = { slice, move: true }`): delete
  // the dragged unit's whole range — deleteRange (not deleteSelection)
  // because a collapsed heading section spans several sibling blocks;
  // deleteRange also trims empty ancestors (a source list emptied by the
  // move disappears).
  tr.deleteRange(block.from, block.to);

  // Insert at the snapped position (mapped through the deletion).
  // replaceRange (not replaceRangeWith): it fits/wraps the content into
  // the target context — an item dropped at the doc level wraps into a
  // new list, an item dropped between items joins that list.
  const pos = tr.mapping.map(insertPos);
  tr.replaceRange(pos, pos, slice);

  // Selection: on the moved unit when it stayed a selectable node,
  // otherwise (wrapped/converted) just near the insertion point.
  const inserted = slice.content.firstChild!;
  const $after = tr.doc.resolve(pos);
  const nodeAfter = $after.nodeAfter;
  if (
    NodeSelection.isSelectable(inserted) &&
    nodeAfter != null &&
    nodeAfter.eq(inserted)
  ) {
    tr.setSelection(NodeSelection.create(tr.doc, pos));
  } else {
    tr.setSelection(Selection.near($after));
  }

  // Fold state must follow the moved content (see buildFoldRemapMetas).
  const remap = buildFoldRemapMetas(view.state, tr, block, pos);
  if (remap != null) {
    tr.setMeta(headingFoldingKey, remap.heading);
    tr.setMeta(taskFoldingKey, remap.task);
  }

  tr.setMeta(dragHandleKey, { type: "dragEnd" } satisfies DragHandleMeta);
  view.focus();
  view.dispatch(tr);
  return true;
}

export interface DragHandlePluginOptions {
  excludedTypes: readonly string[];
}

/** Outline decorations for the dragged unit: one node decoration per
 *  whole top-level block inside [from, to) (a collapsed heading section
 *  spans several siblings; node decorations must cover exactly one node).
 *  Non-heading units are single nodes, so this yields one decoration. */
function dragSourceDecorations(
  doc: PMNode,
  block: DraggableBlock,
): Decoration[] {
  const decorations: Decoration[] = [];
  doc.nodesBetween(block.from, block.to, (node, pos) => {
    if (node.isBlock && pos >= block.from && pos + node.nodeSize <= block.to) {
      decorations.push(
        Decoration.node(pos, pos + node.nodeSize, {
          class: DRAG_HANDLE_CSS.dragSource,
        }),
      );
      return false;
    }
    return true;
  });
  return decorations;
}

/** Bullet/ordered/task list node — the units that own whole-list handles. */
function isListNode(node: PMNode): boolean {
  return (
    node.type.name === "bulletList" ||
    node.type.name === "orderedList" ||
    node.type.name === "taskList"
  );
}

/**
 * The enclosing list of a dragged unit: the nearest bullet/ordered/task list
 * ancestor at ANY depth (a nested subtask promotes to its parent taskList —
 * which may itself be nested), used when positioning an item's handle (the
 * dots align with the list's left edge). Null for non-list units.
 */
function enclosingListBlock(
  view: EditorView,
  block: DraggableBlock,
): DraggableBlock | null {
  const $pos = view.state.doc.resolve(block.from);
  for (let depth = $pos.depth; depth >= 1; depth -= 1) {
    const node = $pos.node(depth);
    if (isListNode(node)) {
      const from = $pos.before(depth);
      return { node, from, to: from + node.nodeSize };
    }
  }
  return null;
}

export function createDragHandlePlugin(
  options: DragHandlePluginOptions,
): Plugin<DragHandleState> {
  return new Plugin<DragHandleState>({
    key: dragHandleKey,

    state: {
      init: (): DragHandleState => ({ drag: null }),
      apply(tr, value, oldState): DragHandleState {
        const meta = tr.getMeta(dragHandleKey) as DragHandleMeta | undefined;
        if (meta?.type === "dragStart") {
          return { drag: { block: meta.block, insertPos: meta.block.from } };
        }
        if (meta?.type === "dragMove") {
          if (value.drag == null) return value;
          return { drag: { ...value.drag, insertPos: meta.insertPos } };
        }
        if (meta?.type === "dragEnd") {
          return { drag: null };
        }
        // Keep the drag alive across doc/selection changes (they map below).
        if (value.drag != null && (tr.docChanged || tr.selectionSet)) {
          const fromResult = tr.mapping.mapResult(value.drag.block.from);
          if (fromResult.deleted) {
            return { drag: null };
          }
          // The unit may itself have been edited into a different node —
          // nodeAt can return null at the doc end or a text node there;
          // either way the drag target is gone, drop the drag instead of
          // crashing inside apply (a thrown error would brick the editor).
          const mappedNode = tr.doc.nodeAt(fromResult.pos);
          if (mappedNode == null || !mappedNode.eq(value.drag.block.node)) {
            return { drag: null };
          }
          let block: DraggableBlock = {
            node: mappedNode,
            from: fromResult.pos,
            to: fromResult.pos + mappedNode.nodeSize,
          };
          // A collapsed heading section spans several sibling blocks, so
          // only its heading range maps cleanly here — re-expand the range
          // through the folds (mapped through this transaction, the same
          // mapResult rule the heading folding plugin itself uses) to keep
          // covering the whole section.
          if (
            block.to < value.drag.block.to &&
            mappedNode.type.name === "heading"
          ) {
            const prevFolded = headingFoldingKey.getState(oldState)?.folded;
            const mapped = new Set<number>();
            if (prevFolded != null) {
              for (const pos of prevFolded) {
                const result = tr.mapping.mapResult(pos);
                if (!result.deleted) {
                  mapped.add(result.pos);
                }
              }
            }
            const expanded = expandThroughFolds(
              tr.doc,
              mapped,
              block,
              [] as readonly string[],
            );
            if (expanded.to > block.to) {
              block = expanded;
            }
          }
          const insertPos =
            value.drag.insertPos == null
              ? null
              : tr.mapping.map(value.drag.insertPos);
          return { drag: { block, insertPos } };
        }
        return value;
      },
    },

    props: {
      decorations(state) {
        const drag = dragHandleKey.getState(state)?.drag;
        if (drag == null || drag.insertPos == null) {
          return DecorationSet.empty;
        }
        const decorations = [
          // Drop line at the snapped insertion position. Height 0 (CSS) so
          // the widget never shifts the layout; drawn at the block boundary.
          Decoration.widget(
            drag.insertPos,
            () => {
              const el = createDiv();
              el.className = DRAG_HANDLE_CSS.dropLine;
              return el;
            },
            { side: -1, key: `texto-drag-drop-line-${drag.insertPos}` },
          ),
          // Outline around the dragged unit while it moves — the user must
          // always see what is being carried and where it will land. A
          // collapsed heading section spans several SIBLING blocks, and a
          // node decoration must cover exactly one whole node (view's
          // NodeType.valid rejects partial ranges) — so outline every
          // top-level block of the range, like the fold plugin's own hide
          // decorations; the hidden blocks carry no visual box anyway.
          ...dragSourceDecorations(state.doc, drag.block),
        ];
        return DecorationSet.create(state.doc, decorations);
      },
    },

    view(editorView: EditorView) {
      return createDragHandleView(editorView, options);
    },
  });
}

interface DragHandleView {
  handle: HTMLElement;
  update(view: EditorView, prevState: EditorState): void;
  destroy(): void;
}

/** One pooled handle element bound to the unit it currently grabs (null
 *  when hidden/free). Several handles are visible at once: the hovered
 *  unit's own dots handle plus one whole-list handle per enclosing list. */
interface HandleSlot {
  el: HTMLElement;
  block: DraggableBlock | null;
}

function createDragHandleView(
  view: EditorView,
  options: DragHandlePluginOptions,
): DragHandleView {
  const handle = createHandleDom();
  // The editor's scroll container (the .texto-editor host element). The
  // first pool slot is created eagerly so the container always carries the
  // handle DOM (and stale-state tests can grab it).
  const container = view.dom.parentElement;
  if (container == null) {
    return {
      handle,
      update: () => undefined,
      destroy: () => undefined,
    };
  }
  container.appendChild(handle);

  // ── Handle pool ──
  const pool: HandleSlot[] = [{ el: handle, block: null }];
  // Active pointer drag state (set on pointerdown on a handle or chevron).
  let dragBlock: DraggableBlock | null = null;
  let dragStartPoint: { x: number; y: number } | null = null;
  let dragActive = false;

  /** The slot at index i (creating elements as needed). render() owns the
   *  slot set wholesale — it re-binds slots by index and releases the tail,
   *  so stale slots can never linger visible with old positions. */
  const slotAt = (index: number): HandleSlot => {
    const existing = pool[index];
    if (existing != null) {
      return existing;
    }
    const el = createHandleDom();
    el.addEventListener("pointerdown", onHandlePointerDown);
    container.appendChild(el);
    const slot: HandleSlot = { el, block: null };
    pool.push(slot);
    return slot;
  };

  /** A free slot for one-off overlays (the chevron hold-grab). */
  const acquireSlot = (): HandleSlot => {
    const free = pool.find((s) => s.block == null);
    return free ?? slotAt(pool.length);
  };

  /** Release slots from `from` up: unbind and hide. */
  const releaseSlotsFrom = (from: number): void => {
    for (let i = from; i < pool.length; i += 1) {
      const slot = pool[i];
      slot.block = null;
      slot.el.classList.remove(DRAG_HANDLE_CSS.visible);
      slot.el.classList.remove(DRAG_HANDLE_CSS.dragging);
    }
  };

  /** The fold chevron currently swapped for a dots handle (hold-grab), if
   *  any — it must come back when the handle goes away. */
  let overlayChevron: HTMLElement | null = null;

  /** Bring the swapped-out chevron back. */
  const clearChevronOverlay = (): void => {
    if (overlayChevron != null) {
      overlayChevron.classList.remove(DRAG_HANDLE_CSS.chevronGrabbed);
      overlayChevron = null;
    }
  };

  /** The chevron force-revealed because its unit is hovered (the block's
   *  own :hover rules don't reach into the gutter). */
  let hoverChevronEl: HTMLElement | null = null;

  const clearHoverChevron = (): void => {
    if (hoverChevronEl != null) {
      hoverChevronEl.classList.remove(DRAG_HANDLE_CSS.chevronHover);
      hoverChevronEl = null;
    }
  };

  const hide = () => {
    clearHoverChevron();
    clearChevronOverlay();
    releaseSlotsFrom(0);
  };

  /** Swap the dots handle into the chevron's place (hold-grab, or the
   *  first movement of a chevron-initiated drag): the chevron hides via
   *  is-grabbed, one pool slot takes its place. */
  const showHandleAtChevronHover = (
    block: DraggableBlock,
    chevron: HTMLElement,
  ): void => {
    if (overlayChevron != null && overlayChevron !== chevron) {
      clearChevronOverlay();
    }
    overlayChevron = chevron;
    chevron.classList.add(DRAG_HANDLE_CSS.chevronGrabbed);
    const slot = acquireSlot();
    slot.block = block;
    showHandleAtChevron(slot.el, chevron);
  };

  /** Render the handles for the hovered unit:
   *  - a SINGLE-ITEM list IS its item (dragging either moves the same
   *    content) — resolve it to the item, so only one handle shows;
   *  - fold-chevron units (headings, foldable task items) grab by their
   *    chevron — it is force-revealed instead of a dots handle;
   *  - every other unit gets its own dots handle (a hovered list gets no
   *    extra dots — its whole-list handle covers it);
   *  - plus one whole-list handle per enclosing list WITH MORE THAN ONE
   *    item (a one-item list handle would duplicate its only item's own
   *    handle for the same move), glued to the list's first item, one slot
   *    left of the first item's own grab point. */
  const render = (unit: DraggableBlock): void => {
    if (isListNode(unit.node) && unit.node.childCount === 1) {
      const first = unit.node.content.firstChild;
      if (first != null) {
        const firstFrom = unit.from + 1;
        unit = { node: first, from: firstFrom, to: firstFrom + first.nodeSize };
      }
    }
    const wanted: { block: DraggableBlock; kind: "unit" | "list" }[] = [];
    const chevron = grabChevronOf(view, unit);
    if (chevron != null) {
      if (hoverChevronEl !== chevron) {
        clearHoverChevron();
        hoverChevronEl = chevron;
        chevron.classList.add(DRAG_HANDLE_CSS.chevronHover);
      }
    } else if (!isListNode(unit.node)) {
      wanted.push({ block: unit, kind: "unit" });
    }
    for (const list of listAncestorsOf(unit)) {
      if (list.node.childCount > 1) {
        wanted.push({ block: list, kind: "list" });
      }
    }
    let i = 0;
    for (const w of wanted) {
      const slot = slotAt(i);
      if (w.kind === "unit") {
        positionHandle(view, slot.el, w.block, container);
      } else {
        positionListHandle(view, slot.el, w.block, container);
      }
      slot.el.classList.add(DRAG_HANDLE_CSS.visible);
      slot.block = w.block;
      i += 1;
    }
    releaseSlotsFrom(i);
  };

  /** All draggable units with their viewport strips: top-level blocks and
   *  list/task items at EVERY nesting level (subtasks included). Each unit
   *  owns its full DOM rect — the deepest unit whose rect contains the
   *  pointer Y is the hovered one; the whole strip left of its content
   *  (the gutter, however far left) belongs to it. Blocks hidden by folds
   *  (collapsed heading sections, folded task items) have no visible box
   *  (zero-height rects) and are skipped; a collapsed section's heading
   *  is expanded to the whole section (heading + hidden body). */
  const collectUnits = (): {
    block: DraggableBlock;
    top: number;
    bottom: number;
    depth: number;
  }[] => {
    const doc = view.state.doc;
    const folded = headingFoldingKey.getState(view.state)?.folded;
    const units: {
      block: DraggableBlock;
      top: number;
      bottom: number;
      depth: number;
    }[] = [];

    const push = (block: DraggableBlock, depth: number): void => {
      const dom = blockDomAt(view, block.from);
      if (dom == null) {
        return;
      }
      const rect = dom.getBoundingClientRect();
      // Hidden blocks (folded away) have no visible box.
      if (rect.bottom - rect.top <= 1) {
        return;
      }
      units.push({ block, top: rect.top, bottom: rect.bottom, depth });
    };

    // Walk the block tree; `base` is the position the node's content
    // starts (doc: 0, any other node: its own start + 1).
    const walk = (node: PMNode, base: number, depth: number): void => {
      node.forEach((child, offset) => {
        const childPos = base + offset;
        if (isListNode(child)) {
          let itemPos = childPos + 1;
          child.content.content.forEach((item) => {
            push(
              { node: item, from: itemPos, to: itemPos + item.nodeSize },
              depth + 1,
            );
            // Nested lists inside the item (subtasks).
            walk(item, itemPos + 1, depth + 1);
            itemPos += item.nodeSize;
          });
          return;
        }
        if (!child.isBlock) {
          return;
        }
        if (depth === 0) {
          // A top-level block is a unit — unless it is hidden inside a
          // collapsed heading section (no box; the section's heading owns
          // it and is pushed expanded to the full section range).
          if (options.excludedTypes.includes(child.type.name)) {
            return;
          }
          const section = collapsedHeadingRange(doc, folded, childPos);
          if (section == null) {
            push(
              { node: child, from: childPos, to: childPos + child.nodeSize },
              1,
            );
          } else if (section.headingPos === childPos) {
            push({ node: child, from: section.from, to: section.to }, 1);
          }
        }
        // Recurse into containers for lists they may hold (blockquote…).
        walk(child, childPos + 1, depth + 1);
      });
    };
    walk(doc, 0, 0);
    return units;
  };

  /** The hovered unit: the deepest unit whose strip contains Y (equal
   *  depths — the tighter strip wins; sibling strips don't overlap, the
   *  tolerance only bridges inter-block margins). */
  const resolveUnitAtY = (y: number): DraggableBlock | null => {
    let best: {
      block: DraggableBlock;
      top: number;
      bottom: number;
      depth: number;
    } | null = null;
    for (const unit of collectUnits()) {
      if (
        y < unit.top - LINE_STICKY_TOLERANCE ||
        y > unit.bottom + LINE_STICKY_TOLERANCE
      ) {
        continue;
      }
      if (
        best == null ||
        unit.depth > best.depth ||
        (unit.depth === best.depth &&
          unit.bottom - unit.top < best.bottom - best.top)
      ) {
        best = unit;
      }
    }
    return best?.block ?? null;
  };

  /** All list ancestors of the unit, outermost first — each gets a
   *  whole-list handle while the pointer is within the unit (and therefore
   *  within every ancestor list). A hovered list itself is included. */
  const listAncestorsOf = (block: DraggableBlock): DraggableBlock[] => {
    const lists: DraggableBlock[] = [];
    if (isListNode(block.node)) {
      lists.push(block);
    }
    const $pos = view.state.doc.resolve(block.from);
    for (let depth = $pos.depth; depth >= 1; depth -= 1) {
      const node = $pos.node(depth);
      if (isListNode(node)) {
        const from = $pos.before(depth);
        lists.push({ node, from, to: from + node.nodeSize });
      }
    }
    return lists;
  };

  const onMouseMove = (event: MouseEvent) => {
    if (view.isDestroyed || !view.editable) {
      hide();
      return;
    }
    // A press is in progress (a handle grab or a chevron hold): the drag
    // flow owns the pointer — hover resolution must not steal the overlay
    // or re-position handles mid-press (sub-pixel jitter would otherwise
    // cancel the grab look).
    if (dragBlock != null) {
      return;
    }
    const unit = resolveUnitAtY(event.clientY);
    if (unit == null) {
      hide();
      return;
    }
    render(unit);
  };

  // ── Pointer drag (Notion-style, no native HTML5 DnD) ──

  // The element the drag was pressed on (a pooled handle or a fold
  // chevron); needed to release capture and to style the source while
  // dragging.
  let dragSource: HTMLElement | null = null;
  // True when the press started on a pooled dots handle (vs a chevron):
  // decides the styling and the click re-dispatch on release.
  let dragFromHandle = false;
  // Suppress the fold-toggle click right after a chevron-initiated drag:
  // the DOM fires click on pointerup in the same spot even after a move.
  let suppressChevronClickUntil = 0;

  /** The hovered unit's first-line strip in viewport coords (items: their
   *  first text line — their DOM rect covers nested content too; other
   *  units: the block's DOM rect). Used by the drop-target lookup. */
  const hoveredStrip = (
    block: DraggableBlock,
  ): { top: number; bottom: number } | null => {
    if (DRAG_HANDLE_ITEM_TYPES.includes(block.node.type.name)) {
      const textPos = firstTextPos(block);
      if (textPos != null) {
        try {
          const coords = view.coordsAtPos(textPos);
          if (
            Number.isFinite(coords.top) &&
            Number.isFinite(coords.bottom) &&
            coords.bottom > coords.top
          ) {
            return { top: coords.top, bottom: coords.bottom };
          }
        } catch {
          // fall through to the DOM rect
        }
      }
    }
    const dom = blockDomAt(view, block.from);
    if (dom == null) {
      return null;
    }
    const rect = dom.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom };
  };

  const onHandlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || view.isDestroyed || !view.editable) {
      return;
    }
    const slot = pool.find((s) => s.el === event.currentTarget);
    if (slot == null || slot.block == null) {
      return;
    }
    dragBlock = slot.block;
    dragStartPoint = { x: event.clientX, y: event.clientY };
    dragSource = slot.el;
    dragFromHandle = true;
    // Capture on the handle so pointermove/up keep arriving even outside.
    try {
      slot.el.setPointerCapture(event.pointerId);
    } catch {
      // Some environments refuse capture — document handlers cover it.
    }
    event.preventDefault();
  };

  /** Delegated on view.dom: pointerdown on a fold chevron arms a drag of
   *  the chevron's own unit. A plain click (press+release without movement)
   *  still folds — the fold handlers run on click, and this only records
   *  the pending drag, canceling it on pointerup if the pointer never
   *  crossed the drag threshold. */
  /** After holding a chevron this long without moving, it visually turns
   *  into the drag handle (grab look) — the user expects feedback while
   *  holding, before any movement. Below this window a press+release is a
   *  plain fold click. */
  const CHEVRON_HOLD_GRAB_MS = 150;

  const onChevronPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || view.isDestroyed || !view.editable) {
      return;
    }
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const chevron = target.closest(
      DRAG_HANDLE_CSS.gutterControls.map((c) => `.${c}`).join(", "),
    );
    if (chevron == null) {
      return;
    }
    const block = blockByChevron(chevron);
    if (block == null) {
      return;
    }
    dragBlock = block;
    dragStartPoint = { x: event.clientX, y: event.clientY };
    dragSource = chevron as HTMLElement;
    dragFromHandle = false;
    // Hold feedback: after a short hold the chevron turns into the drag
    // handle look even before any movement. Cancelled on move/drag start.
    scheduleHoldGrab();
    // Deliberately NO pointer capture here: with capture the browser would
    // retarget pointerup to the chevron and fire a native click on it —
    // doubling the fold toggle with finishDrag's own re-dispatch. Without
    // capture a held release lands on the dots overlay (a non-descendant),
    // the native click targets a common ancestor, and the single
    // re-dispatched click in finishDrag is the only fold toggle. The
    // document-level move/up handlers follow the pointer either way.
    // No preventDefault here: a plain click must still reach the fold
    // handlers (they listen for click and check for movement themselves
    // via the suppressed-click window below).
  };

  /** Show the grab look on the held chevron after the hold window. */
  let holdGrabTimer: number | null = null;
  /** True while the dots-handle overlay is shown over a held chevron: the
   *  pending DOM click on release would hit the OVERLAY instead of the
   *  chevron, so finishDrag re-dispatches it (see there). */
  let holdGrabShown = false;
  const scheduleHoldGrab = (): void => {
    clearHoldGrab();
    holdGrabTimer = window.setTimeout(() => {
      holdGrabTimer = null;
      if (dragBlock == null || dragActive || dragSource == null) {
        return;
      }
      holdGrabShown = true;
      // Same overlay as hover (tracks the hidden chevron so a released
      // click still reaches the fold, see finishDrag).
      showHandleAtChevronHover(dragBlock, dragSource);
    }, CHEVRON_HOLD_GRAB_MS);
  };
  const clearHoldGrab = (): void => {
    if (holdGrabTimer != null) {
      window.clearTimeout(holdGrabTimer);
      holdGrabTimer = null;
    }
  };

  /** The draggable unit owning a fold chevron element (viewport DOM ->
   *  doc position -> DraggableBlock, fold-expanded like any other path).
   *  The chevron's center is inline content of its heading/item, so
   *  posAtCoords there resolves into the unit — the canonical path. */
  const blockByChevron = (chevron: Element): DraggableBlock | null => {
    if (!view.dom.contains(chevron)) {
      return null;
    }
    const rect = chevron.getBoundingClientRect();
    const center = {
      left: rect.left + rect.width / 2,
      top: rect.top + rect.height / 2,
    };
    const posResult = view.posAtCoords(center);
    let pos = posResult?.pos ?? posResult?.inside ?? null;
    if (pos == null) {
      return null;
    }
    // A chevron sits in contenteditable=false chrome (the task item's
    // label column): posAtCoords may resolve to the doc position of the
    // ITEM itself (its before-boundary), where resolve() has no item
    // ancestor — findDraggableBlock would hand back the whole list.
    // Step one position forward in that case: inside the item.
    const doc = view.state.doc;
    const nodeAtPos = doc.nodeAt(pos);
    if (
      nodeAtPos != null &&
      DRAG_HANDLE_ITEM_TYPES.includes(nodeAtPos.type.name)
    ) {
      pos = pos + 1;
    }
    return findDraggableBlock(doc, pos, options.excludedTypes, view.state);
  };

  /** Delegated on view.dom (capture): swallow the fold-toggle click that
   *  the browser fires on a chevron after a completed drag. */
  const onChevronClickCapture = (event: MouseEvent) => {
    if (Date.now() >= suppressChevronClickUntil) {
      return;
    }
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    if (
      target.closest(
        DRAG_HANDLE_CSS.gutterControls.map((c) => `.${c}`).join(", "),
      ) != null
    ) {
      event.stopPropagation();
      event.preventDefault();
    }
  };

  /** The drop target position for a pointer at (clientX, clientY).
   *
   *  Like PM's default drop, the target snaps to block boundaries via
   *  dropPoint; the raw position comes from two sources:
   *   1. posAtCoords when the pointer is over the content — the canonical
   *      path (same as editHandlers.drop);
   *   2. the gutter-fallback when posAtCoords returns null: the pointer is
   *      LEFT of the content (where the handles live and where drags are
   *      usually held). The unit whose vertical strip contains the pointer
   *      Y is found geometrically (like the hover lookup, but
   *      boundaries-only and outside the dragged range: hidden blocks of
   *      collapsed sections have no box and must not become targets), and
   *      the boundary before/after it by the half of its height. */
  const resolveInsertPos = (
    block: DraggableBlock,
    clientX: number,
    clientY: number,
  ): number | null => {
    const doc = view.state.doc;
    let pos: number | null = null;

    const posResult = view.posAtCoords({ left: clientX, top: clientY });
    if (posResult != null) {
      pos = posResult.pos;
    } else {
      pos = gutterDropPos(block, clientY);
    }
    if (pos == null) {
      return null;
    }

    const slice = doc.slice(block.from, block.to);
    // A collapsed heading section hides its body (posAtCoords may hit
    // the hidden blocks' stale rects), so the raw position is biased back
    // to the nearest boundary OUTSIDE the dragged range — dropping onto
    // the dragged section itself must cancel, not split it.
    if (pos > block.from && pos < block.to) {
      pos = pos - block.from <= block.to - pos ? block.from : block.to;
    }
    return dropPoint(doc, pos, slice);
  };

  /** Boundary position for a pointer in the gutter (posAtCoords is null
   *  there): the unit whose vertical strip contains Y — top-level blocks
   *  and, deeper, list/task items at every nesting level (their strips are
   *  resolved like the hover lookup) — then the boundary before/after the
   *  found unit by the half of its height. Collapsed section members have
   *  no visible box and resolve through their section's heading; units
   *  inside the dragged range yield no target (the drop cancels). */
  const gutterDropPos = (
    block: DraggableBlock,
    clientY: number,
  ): number | null => {
    const doc = view.state.doc;
    const folded = headingFoldingKey.getState(view.state)?.folded;

    type DropTarget = {
      pos: number;
      size: number;
      top: number;
      bottom: number;
      isItem: boolean;
    };
    const targets: DropTarget[] = [];
    const consider = (
      pos: number,
      size: number,
      rect: { top: number; bottom: number },
      isItem: boolean,
    ) => {
      if (
        clientY < rect.top - LINE_STICKY_TOLERANCE ||
        clientY > rect.bottom + LINE_STICKY_TOLERANCE
      ) {
        return;
      }
      targets.push({ pos, size, top: rect.top, bottom: rect.bottom, isItem });
    };

    const itemDomRect = (
      block: DraggableBlock,
    ): { top: number; bottom: number } | null => {
      // An item's own DOM rect covers its nested content too (the hidden
      // subtask list is display:none inside it) — the first LINE is the
      // grab strip, resolved like hoveredStrip.
      return hoveredStrip(block);
    };

    const collectItems = (node: PMNode, pos: number) => {
      if (
        node.type.name === "bulletList" ||
        node.type.name === "orderedList" ||
        node.type.name === "taskList"
      ) {
        let itemPos = pos + 1;
        node.content.content.forEach((item) => {
          const rect = itemDomRect({
            node: item,
            from: itemPos,
            to: itemPos + item.nodeSize,
          });
          if (rect != null) {
            consider(itemPos, item.nodeSize, rect, true);
          }
          item.content.content.forEach((child, i) => {
            if (
              child.type.name === "bulletList" ||
              child.type.name === "orderedList" ||
              child.type.name === "taskList"
            ) {
              collectItems(
                child,
                itemPos +
                  1 +
                  item.content.content
                    .slice(0, i)
                    .reduce((s, n) => s + n.nodeSize, 0),
              );
            }
          });
          itemPos += item.nodeSize;
        });
      }
    };

    doc.forEach((node, pos) => {
      if (options.excludedTypes.includes(node.type.name)) {
        return;
      }
      // A block inside a collapsed section has no visible box; the
      // section's heading owns its strip (dragging that whole section
      // cancels via the inside-range check).
      const section = collapsedHeadingRange(doc, folded, pos);
      if (section != null && section.headingPos !== pos) {
        return;
      }
      const dom = blockDomAt(view, pos);
      if (dom != null) {
        consider(pos, node.nodeSize, dom.getBoundingClientRect(), false);
      }
      collectItems(node, pos);
    });

    // Pick the drop target: the deepest item wins; among items (and among
    // blocks) the one whose strip center is closest to Y.
    let best: DropTarget | null = null;
    for (const target of targets) {
      if (best == null) {
        best = target;
        continue;
      }
      const targetDist = Math.abs((target.top + target.bottom) / 2 - clientY);
      const bestDist = Math.abs((best.top + best.bottom) / 2 - clientY);
      if (
        (target.isItem && !best.isItem) ||
        (target.isItem === best.isItem && targetDist < bestDist)
      ) {
        best = target;
      }
    }
    if (best == null) {
      return null;
    }
    const isAfter = clientY > (best.top + best.bottom) / 2;
    const boundary = isAfter ? best.pos + best.size : best.pos;
    // Dropping onto the dragged unit's own range cancels (finishDrag).
    if (boundary >= block.from && boundary <= block.to) {
      return null;
    }
    return boundary;
  };

  const onPointerMove = (event: PointerEvent) => {
    if (dragBlock == null || dragStartPoint == null) {
      return;
    }
    const dx = event.clientX - dragStartPoint.x;
    const dy = event.clientY - dragStartPoint.y;
    if (!dragActive) {
      // Grab feedback while still below the drag threshold: the held
      // chevron has already turned into the drag-handle look (by the hold
      // timer or on first movement) — nothing more to do until it arms.
      if (Math.hypot(dx, dy) < DRAG_START_THRESHOLD) {
        return;
      }
      clearHoldGrab();
      dragActive = true;
      // A chevron-initiated drag: swap the dots handle into the chevron's
      // place right away (it may not have appeared yet when the pointer
      // moved before the hold window) — the grab affordance must be
      // visible for the whole drag. Skip when the hold window already
      // swapped it in (overlayChevron set) — a second overlay would stack.
      if (
        !dragFromHandle &&
        dragSource != null &&
        dragBlock != null &&
        overlayChevron == null
      ) {
        showHandleAtChevronHover(dragBlock, dragSource);
      }
      if (dragFromHandle) {
        dragSource?.classList.add(DRAG_HANDLE_CSS.dragging);
      } else {
        dragSource?.classList.add(DRAG_HANDLE_CSS.chevronDragging);
      }
      // Arm fold-click suppression: the browser will fire a click on the
      // chevron after pointerup, and it must NOT toggle the fold.
      suppressChevronClickUntil = Date.now() + 150;
      // Show the drag in plugin state (drop line at the source position).
      view.dispatch(
        view.state.tr.setMeta(dragHandleKey, {
          type: "dragStart",
          block: dragBlock,
        } satisfies DragHandleMeta),
      );
    }
    const insertPos = resolveInsertPos(dragBlock, event.clientX, event.clientY);
    const pluginState = dragHandleKey.getState(view.state);
    const current = pluginState?.drag?.insertPos ?? null;
    if (insertPos !== current) {
      view.dispatch(
        view.state.tr
          .setMeta(dragHandleKey, {
            type: "dragMove",
            insertPos,
          } satisfies DragHandleMeta)
          .setMeta("addToHistory", false),
      );
    }
  };

  /** Place a pooled dots handle over a fold chevron (the chevron is hidden
   *  via the grabbed class, the handle takes its place): the visible drag
   *  affordance while a chevron-initiated drag is held. The dots are
   *  centered on the chevron's GLYPH (the inner svg), not on its box's
   *  left edge — the dots svg (16px in a 24px handle) and the chevron svg
   *  (12px in an 18px host) would otherwise sit ~3px apart. The handle is
   *  at least HANDLE_MIN_HEIGHT tall, centered on the same glyph. */
  const showHandleAtChevron = (el: HTMLElement, chevron: HTMLElement): void => {
    const glyph = chevron.querySelector("svg") ?? chevron;
    const glyphRect = glyph.getBoundingClientRect();
    const chevronRect = chevron.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const centerX = glyphRect.left + glyphRect.width / 2;
    const centerY = glyphRect.top + glyphRect.height / 2;
    const height = Math.max(chevronRect.height, HANDLE_MIN_HEIGHT);
    el.style.left = `${centerX - HANDLE_WIDTH / 2 - containerRect.left + container.scrollLeft}px`;
    el.style.top = `${centerY - height / 2 - containerRect.top + container.scrollTop}px`;
    el.style.height = `${height}px`;
    el.classList.add(DRAG_HANDLE_CSS.visible);
  };

  const finishDrag = (event: PointerEvent, apply: boolean) => {
    clearHoldGrab();
    if (dragBlock == null) {
      return;
    }
    const block = dragBlock;
    const wasActive = dragActive;
    // The chevron swapped out under the dots overlay (hold-grab), if any —
    // a released click must still reach it (the fold must toggle).
    const hoverChevron = overlayChevron;
    dragBlock = null;
    dragStartPoint = null;
    dragActive = false;
    const source = dragSource;
    const fromHandle = dragFromHandle;
    dragSource = null;
    dragFromHandle = false;
    clearChevronOverlay();
    try {
      // Only handle presses captured the pointer (chevron presses don't —
      // see onChevronPointerDown).
      if (fromHandle && source != null && event.pointerId != null) {
        source.releasePointerCapture(event.pointerId);
      }
    } catch {
      // pointer capture may already be gone
    }
    releaseSlotsFrom(0);
    if (source != null && !fromHandle) {
      source.classList.remove(DRAG_HANDLE_CSS.chevronDragging);
    }
    if (!wasActive && holdGrabShown && hoverChevron != null) {
      // Released without crossing the drag threshold after the hold
      // window: the dots overlay swallowed the browser's own click (it sat
      // on top of the chevron at release), so re-dispatch it — the fold
      // must toggle like on a quick click.
      window.setTimeout(() => {
        hoverChevron.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true }),
        );
      }, 0);
    }
    holdGrabShown = false;
    // Keep the suppression window armed briefly after a drag so the
    // trailing click (fired right after pointerup) is swallowed.
    if (wasActive) {
      suppressChevronClickUntil = Date.now() + 150;
    }

    if (wasActive && apply) {
      const insertPos = resolveInsertPos(block, event.clientX, event.clientY);
      // No target position (outside the editor) or a no-op drop (on the
      // dragged block itself) cancels the move.
      const insideSelf =
        insertPos != null && insertPos >= block.from && insertPos <= block.to;
      if (
        insertPos != null &&
        !insideSelf &&
        performBlockMove(view, block, insertPos)
      ) {
        return;
      }
    }
    // Cancelled: clear the drag state (removes the drop line) and the
    // hover visuals — the next mousemove re-renders the handles.
    view.dispatch(
      view.state.tr
        .setMeta(dragHandleKey, { type: "dragEnd" } satisfies DragHandleMeta)
        .setMeta("addToHistory", false),
    );
    hide();
  };

  const onPointerUp = (event: PointerEvent) => {
    finishDrag(event, true);
  };
  const onPointerCancel = (event: PointerEvent) => {
    finishDrag(event, false);
  };

  container.addEventListener("mousemove", onMouseMove);
  container.addEventListener("mouseleave", hide);
  handle.addEventListener("pointerdown", onHandlePointerDown);
  // Chevron drags start inside view.dom (fold widgets / item labels); the
  // move/up handlers live on the document so a drag started anywhere —
  // handle or chevron — follows the same flow (pointer capture routes the
  // events to the source element, the document still sees them bubbling).
  // The chevron pointerdown is a CAPTURE listener: the chevron's own
  // handlers stopPropagation() on pointerdown (heading chevron: keep PM
  // from starting a selection), which would kill a bubble-phase listener.
  view.dom.addEventListener("pointerdown", onChevronPointerDown, true);
  view.dom.addEventListener("click", onChevronClickCapture, true);
  document.addEventListener("pointermove", onPointerMove);
  document.addEventListener("pointerup", onPointerUp);
  document.addEventListener("pointercancel", onPointerCancel);

  return {
    handle,
    /** The document changed under a visible handle (typing, new blocks,
     *  remote overwrite): the hovered unit and the handle's position are
     *  stale, so hide the handle — the next mousemove re-resolves the
     *  hover. Also hides when a plugin-state drag just ended. An active
     *  drag is untouched: while it moves it only dispatches meta
     *  transactions (no doc change), and the move itself runs after the
     *  drag state is already cleared. */
    update(updatedView: EditorView, prevState: EditorState): void {
      if (dragBlock != null) {
        return;
      }
      const dragNow = dragHandleKey.getState(updatedView.state)?.drag ?? null;
      if (dragNow != null) {
        return;
      }
      const dragBefore = dragHandleKey.getState(prevState)?.drag ?? null;
      const docChanged = !updatedView.state.doc.eq(prevState.doc);
      if (dragBefore == null && !docChanged) {
        return;
      }
      hide();
    },
    destroy() {
      container.removeEventListener("mousemove", onMouseMove);
      container.removeEventListener("mouseleave", hide);
      for (const slot of pool) {
        slot.el.removeEventListener("pointerdown", onHandlePointerDown);
        slot.el.remove();
      }
      view.dom.removeEventListener("pointerdown", onChevronPointerDown, true);
      view.dom.removeEventListener("click", onChevronClickCapture, true);
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointercancel", onPointerCancel);
    },
  };
}

/** Grip dot centers (viewBox 0 0 24 24) — static markup, see styles/drag-handle.css. */
const GRIP_DOT_POSITIONS: ReadonlyArray<readonly [string, string]> = [
  ["9.2", "5.5"],
  ["14.8", "5.5"],
  ["9.2", "12"],
  ["14.8", "12"],
  ["9.2", "18.5"],
  ["14.8", "18.5"],
];
const GRIP_DOT_RADIUS = "1.5";
const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/** Static grip markup (six dots, like tiptap's handle). */
function createHandleDom(): HTMLElement {
  const handle = createDiv();
  handle.className = DRAG_HANDLE_CSS.handle;
  handle.setAttribute("contenteditable", "false");
  handle.setAttribute("aria-hidden", "true");
  handle.setAttribute("data-testid", "block-drag-handle");
  const svg = document.createElementNS(SVG_NAMESPACE, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "currentColor");
  svg.setAttribute("aria-hidden", "true");
  for (const [cx, cy] of GRIP_DOT_POSITIONS) {
    const circle = document.createElementNS(SVG_NAMESPACE, "circle");
    circle.setAttribute("cx", cx);
    circle.setAttribute("cy", cy);
    circle.setAttribute("r", GRIP_DOT_RADIUS);
    svg.appendChild(circle);
  }
  handle.appendChild(svg);
  return handle;
}

/**
 * The DOM element of the block starting at `from`. `view.nodeDOM` returns
 * null for boundary positions of node-view nodes (task item hosts), so this
 * falls back to the container child resolved via `domAtPos`.
 */
function blockDomAt(view: EditorView, from: number): Element | null {
  const byDesc = view.nodeDOM(from);
  if (byDesc instanceof Element) {
    return byDesc;
  }
  const { node, offset } = view.domAtPos(from);
  const child = node.childNodes[offset];
  return child != null && child.instanceOf(Element) ? child : null;
}

/**
 * The fold-chevron element owned by the unit, if the unit's chevron doubles
 * as its grab point: headings always render one; task items only when
 * foldable (nested content present, so the node view renders the chevron).
 * Null for units with a plain dots handle.
 */
function grabChevronOf(
  view: EditorView,
  block: DraggableBlock,
): HTMLElement | null {
  let selector: string | null = null;
  if (block.node.type.name === "heading") {
    selector = ".texto-heading-fold-chevron-host";
  } else if (block.node.type.name === "taskItem" && block.node.childCount > 1) {
    selector = ".texto-task-fold-chevron";
  }
  if (selector == null) {
    return null;
  }
  const dom = blockDomAt(view, block.from);
  return dom?.querySelector(selector) ?? null;
}

/**
 * The vertical anchor for a unit's handle: the unit's FIRST TEXT LINE in
 * the container's content coordinates (absolute positioning inside a
 * scroll container lives in content space, so handles stay glued while
 * scrolling).
 *
 *  - Height/top follow the first line (caret rect via coordsAtPos), so the
 *    handle is exactly as tall as a text line and vertically centered on
 *    it; non-text units (image/attachment atoms) anchor to their DOM top —
 *    coordsAtPos(from+1) resolves to their END boundary, which used to
 *    drop the handle to the block bottom.
 *  - For list/task items the caret at the unit start is degenerate (their
 *    label/checkbox is contenteditable=false), so the first paragraph's
 *    inner position is resolved instead.
 */
function firstLineAnchor(
  view: EditorView,
  block: DraggableBlock,
  container: HTMLElement,
): { top: number; height: number } | null {
  const blockDom = blockDomAt(view, block.from);
  if (blockDom == null) {
    return null;
  }

  const containerRect = container.getBoundingClientRect();
  const toContentY = (viewportY: number) =>
    viewportY - containerRect.top + container.scrollTop;

  const blockRect = blockDom.getBoundingClientRect();
  let top = toContentY(blockRect.top);
  let height = HANDLE_DEFAULT_HEIGHT;
  const textPos = firstTextPos(block);
  const anchorCaret = (coordsPos: number, firstLineOnly: boolean): boolean => {
    try {
      const coords = view.coordsAtPos(coordsPos);
      if (firstLineOnly) {
        // Reject caret rects that sit at an atom's END boundary (from + 1
        // resolves to the node's far side): they must hug the block's first
        // line. A text block's own caret is inside its first line — offset
        // from the DOM top only by the block's own margin — while an atom's
        // end-boundary caret lies a whole block height below the top.
        // Allow up to two line heights of slack, measured against the caret
        // itself, which tolerates any sane line-height/margin ratio.
        const slack = 2 * Math.max(coords.bottom - coords.top, 1);
        if (coords.top - blockRect.top > slack) {
          return false;
        }
      }
      const caretHeight = Math.max(
        coords.bottom - coords.top,
        HANDLE_MIN_HEIGHT,
      );
      const caretTop = toContentY(
        (coords.top + coords.bottom) / 2 - caretHeight / 2,
      );
      if (
        !Number.isFinite(caretTop) ||
        !Number.isFinite(caretHeight) ||
        caretHeight <= 0
      ) {
        return false;
      }
      top = caretTop;
      height = caretHeight;
      return true;
    } catch {
      return false;
    }
  };
  if (textPos != null) {
    anchorCaret(textPos, false);
  } else {
    anchorCaret(block.from + 1, true);
  }
  return { top, height };
}

/**
 * Position a unit's own dots handle: anchored to its first text line
 * (see firstLineAnchor), left of the unit's gutter chrome — for items the
 * dots align with the enclosing list's left edge, so the handle never
 * shifts between neighbors. Fold-chevron units never reach here on plain
 * hover (their chevron is the grab point), only as a hold-grab overlay at
 * the chevron's own place (showHandleAtChevron).
 */
function positionHandle(
  view: EditorView,
  handle: HTMLElement,
  block: DraggableBlock,
  container: HTMLElement,
): void {
  const anchor = firstLineAnchor(view, block, container);
  if (anchor == null) {
    return;
  }
  const blockDom = blockDomAt(view, block.from);
  if (blockDom == null) {
    return;
  }
  const containerRect = container.getBoundingClientRect();

  let base = blockDom.getBoundingClientRect().left;
  const isItem = DRAG_HANDLE_ITEM_TYPES.includes(block.node.type.name);
  const isListUnit = block.node.type.name.endsWith("List");
  const listBlock = isItem
    ? enclosingListBlock(view, block)
    : isListUnit
      ? block
      : null;
  if (listBlock != null) {
    const listDom = blockDomAt(view, listBlock.from);
    if (listDom != null) {
      base = Math.min(base, listDom.getBoundingClientRect().left);
    }
  }
  const left = base - HANDLE_GAP - HANDLE_WIDTH;

  handle.style.top = `${anchor.top}px`;
  handle.style.left = `${left - containerRect.left + container.scrollLeft}px`;
  handle.style.height = `${anchor.height}px`;
}

/**
 * Position a WHOLE-LIST handle: glued to the first item's first line, one
 * handle slot LEFT of the first item's own grab point (its dots slot, or
 * its fold chevron when the first item is foldable). Always visible while
 * the pointer is within the list — the grab point for moving every item
 * at once.
 */
function positionListHandle(
  view: EditorView,
  handle: HTMLElement,
  listBlock: DraggableBlock,
  container: HTMLElement,
): void {
  const first = listBlock.node.content.firstChild;
  if (first == null) {
    return;
  }
  const firstFrom = listBlock.from + 1;
  const firstDom = blockDomAt(view, firstFrom);
  if (firstDom == null) {
    return;
  }
  const anchor = firstLineAnchor(
    view,
    { node: first, from: firstFrom, to: firstFrom + first.nodeSize },
    container,
  );
  if (anchor == null) {
    return;
  }
  const containerRect = container.getBoundingClientRect();

  // X base: the first item's own grab point — its dots slot (aligned with
  // the list's left edge, the same rule as positionHandle for items), or
  // its chevron when foldable. The list handle sits one slot further left.
  let base = firstDom.getBoundingClientRect().left;
  const listDom = blockDomAt(view, listBlock.from);
  if (listDom != null) {
    base = Math.min(base, listDom.getBoundingClientRect().left);
  }
  const chevron = grabChevronOf(view, {
    node: first,
    from: firstFrom,
    to: firstFrom + first.nodeSize,
  });
  if (chevron != null) {
    // The foldable first item's grab point is the chevron itself.
    base = chevron.getBoundingClientRect().left;
  } else {
    // Reserve the first item's own dots slot first.
    base -= HANDLE_GAP + HANDLE_WIDTH;
  }
  const left = base - HANDLE_GAP - HANDLE_WIDTH;

  handle.style.top = `${anchor.top}px`;
  handle.style.left = `${left - containerRect.left + container.scrollLeft}px`;
  handle.style.height = `${anchor.height}px`;
}
