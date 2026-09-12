import type { Node as PMNode } from 'prosemirror-model';
import { dropPoint } from 'prosemirror-transform';
import {
  NodeSelection,
  Plugin,
  PluginKey,
  Selection,
  type EditorState,
  type Transaction,
} from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import {
  collectHeadingSections,
  headingFoldingKey,
  type HeadingFoldingMeta,
  type HeadingSectionRange,
} from '../heading/foldingPlugin';
import {
  taskFoldingKey,
  type TaskFoldingMeta,
} from '../task-item-folding/taskFoldingPlugin';

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
 * Gutter/sticky notes: PM's posAtCoords returns null for coordinates left
 * of the editor content (the gutter where the handle lives), so mousemove
 * keeps the handle visible while the pointer is over the handle itself —
 * otherwise it would vanish before it can be grabbed.
 */

export const dragHandleKey = new PluginKey<DragHandleState>('inscriptumDragHandle');

/** Top-level node kinds that cannot be dragged (the document title). */
export const DRAG_HANDLE_EXCLUDED_TYPES: readonly string[] = ['noteTitle'];

/** Node kinds that drag as individual items (a whole list drags item-wise). */
export const DRAG_HANDLE_ITEM_TYPES: readonly string[] = ['listItem', 'taskItem'];

/** CSS classes (see styles/drag-handle.css). */
export const DRAG_HANDLE_CSS = {
  handle: 'texto-drag-handle',
  visible: 'is-visible',
  dragging: 'is-dragging',
  /** Drop indicator widget class (line between blocks). */
  dropLine: 'texto-drag-drop-line',
  /** Outline class on the dragged unit while moving. */
  dragSource: 'texto-drag-source',
  /** Left-gutter controls that the handle must not overlap (fold chevrons). */
  gutterControls: [
    'texto-heading-fold-chevron-host',
    'texto-task-fold-chevron',
  ],
} as const;

/** Handle geometry — mirrored in styles/drag-handle.css. */
const HANDLE_WIDTH = 24;
/** Gap between the handle and the unit's gutter chrome (fold chevron). */
const HANDLE_GAP = 2;
/** Minimum handle height (the first-line caret rect on paragraphs is ~19px). */
const HANDLE_MIN_HEIGHT = 28;
/** Fallback line height for units whose first line cannot be measured. */
const HANDLE_DEFAULT_HEIGHT = 24;
/** Width of the fold-chevron strip left of a taskList (chevron host is
 *  18px + 4px offset from the label edge) — reserved so item handles never
 *  overlap the chevron and never shift between foldable/plain items. */
const TASK_CHEVRON_ZONE = 22;
/** Vertical tolerance when matching a pointer line to a hovered unit (px). */
const LINE_STICKY_TOLERANCE = 6;
/** Horizontal tolerance around the handle's left edge (px) — the sticky
 *  zone ends this many px left of the handle before promoting to the
 *  enclosing list. */
const HANDLE_STICKY_TOLERANCE = 10;
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
  const first = children?.find((n) => n.type.name === 'paragraph');
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
function findItemAncestor(doc: PMNode, pos: number): { node: PMNode; from: number } | null {
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
  for (const section of collectHeadingSections(doc, 'heading')) {
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
  for (const section of collectHeadingSections(doc, 'heading')) {
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
      return { node: folded.block.node, from: folded.range.from, to: folded.range.to };
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
  | { type: 'dragStart'; block: DraggableBlock }
  | { type: 'dragMove'; insertPos: number | null }
  | { type: 'dragEnd' };

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
      .setMeta(dragHandleKey, { type: 'dragStart', block } satisfies DragHandleMeta)
      .setSelection(NodeSelection.create(view.state.doc, from))
      .setMeta('addToHistory', false),
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
  const searchEnd = Math.min(insertPos + block.to - block.from + 2, tr.doc.content.size);
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
    heading: { type: 'setFolds', positions: Array.from(headingNext) },
    task: { type: 'setFolds', positions: Array.from(taskNext) },
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

  tr.setMeta(dragHandleKey, { type: 'dragEnd' } satisfies DragHandleMeta);
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

/**
 * The enclosing list of a dragged unit: the nearest bullet/ordered/task list
 * ancestor at ANY depth (a nested subtask promotes to its parent taskList —
 * which may itself be nested), used when the pointer moves left of the
 * unit's handle: the whole list becomes grabbable there. Null for non-list
 * units.
 */
function enclosingListBlock(
  view: EditorView,
  block: DraggableBlock,
): DraggableBlock | null {
  const $pos = view.state.doc.resolve(block.from);
  for (let depth = $pos.depth; depth >= 1; depth -= 1) {
    const node = $pos.node(depth);
    if (
      node.type.name === 'bulletList' ||
      node.type.name === 'orderedList' ||
      node.type.name === 'taskList'
    ) {
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
        if (meta?.type === 'dragStart') {
          return { drag: { block: meta.block, insertPos: meta.block.from } };
        }
        if (meta?.type === 'dragMove') {
          if (value.drag == null) return value;
          return { drag: { ...value.drag, insertPos: meta.insertPos } };
        }
        if (meta?.type === 'dragEnd') {
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
          if (block.to < value.drag.block.to && mappedNode.type.name === 'heading') {
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
          const insertPos = value.drag.insertPos == null
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
  destroy(): void;
}

function createDragHandleView(
  view: EditorView,
  options: DragHandlePluginOptions,
): DragHandleView {
  const handle = createHandleDom();
  // The editor's scroll container (the .texto-editor host element).
  const container = view.dom.parentElement;
  if (container == null) {
    return { handle, destroy: () => undefined };
  }
  container.appendChild(handle);

  // The unit the handle is currently glued to (resolved on hover).
  let hoveredBlock: DraggableBlock | null = null;
  // Active pointer drag state (set on pointerdown on the handle).
  let dragBlock: DraggableBlock | null = null;
  let dragStartPoint: { x: number; y: number } | null = null;
  let dragActive = false;

  const hide = () => {
    hoveredBlock = null;
    handle.classList.remove(DRAG_HANDLE_CSS.visible);
    handle.classList.remove(DRAG_HANDLE_CSS.dragging);
  };

  const show = (block: DraggableBlock) => {
    positionHandle(view, handle, block, container);
    handle.classList.add(DRAG_HANDLE_CSS.visible);
  };

  /** The vertical hover strip of the hovered unit (viewport coords):
   *  a list/task item owns its first text line; every other unit owns its
   *  full DOM rect (extended by the line tolerance). */
  const hoveredStrip = (block: DraggableBlock): { top: number; bottom: number } | null => {
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

  /** The block at the pointer Y in the gutter — the deepest list item whose
   *  line contains Y, else the top-level block whose rect contains Y.
   *  Items are collected at EVERY nesting level (subtasks included).
   *  Collapsed heading sections resolve to the whole section (heading +
   *  hidden body): the hidden blocks carry no DOM box (display:none), so
   *  they are skipped as lookup targets and the heading's strip owns the
   *  section; dragging it must carry the hidden body along. */
  const blockByVerticalLookup = (y: number): DraggableBlock | null => {
    const doc = view.state.doc;
    const units: { block: DraggableBlock; top: number; bottom: number }[] = [];
    const folded = headingFoldingKey.getState(view.state)?.folded;

    const pushItemStrip = (block: DraggableBlock) => {
      units.push({ block, top: Number.NaN, bottom: Number.NaN });
    };

    // Recursively collect list items of all nesting levels.
    const collectItems = (node: PMNode, pos: number) => {
      if (
        node.type.name === 'bulletList' ||
        node.type.name === 'orderedList' ||
        node.type.name === 'taskList'
      ) {
        let itemPos = pos + 1;
        node.content.content.forEach((item) => {
          pushItemStrip({ node: item, from: itemPos, to: itemPos + item.nodeSize });
          // Nested lists inside the item (subtasks).
          item.content.content.forEach((child, i) => {
            if (
              child.type.name === 'bulletList' ||
              child.type.name === 'orderedList' ||
              child.type.name === 'taskList'
            ) {
              collectItems(child, itemPos + 1 + item.content.content.slice(0, i).reduce((s, n) => s + n.nodeSize, 0));
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
      const dom = blockDomAt(view, pos);
      if (dom != null) {
        const rect = dom.getBoundingClientRect();
        // Skip blocks hidden inside a collapsed heading section (they
        // have no visible box; the section's heading below owns them). A
        // section's own heading is added AFTER, expanded to the full range.
        const section = collapsedHeadingRange(doc, folded, pos);
        if (section == null || section.headingPos === pos) {
          const block: DraggableBlock =
            section != null
              ? { node, from: section.from, to: section.to }
              : { node, from: pos, to: pos + node.nodeSize };
          units.push({ block, top: rect.top, bottom: rect.bottom });
        }
      }
      collectItems(node, pos);
    });

    // Resolve item strips lazily (first text line), then pick the deepest
    // item whose strip contains Y; items win over the enclosing blocks.
    let bestTop: { block: DraggableBlock; top: number; bottom: number } | null = null;
    let bestIsItem = false;
    for (const unit of units) {
      if (Number.isNaN(unit.top)) {
        const strip = hoveredStrip(unit.block);
        if (strip == null) continue;
        unit.top = strip.top;
        unit.bottom = strip.bottom;
      }
      if (
        y >= unit.top - LINE_STICKY_TOLERANCE &&
        y <= unit.bottom + LINE_STICKY_TOLERANCE
      ) {
        const isItem = DRAG_HANDLE_ITEM_TYPES.includes(unit.block.node.type.name);
        // Prefer the deepest item; among items the one whose line is closest
        // to Y (nested items may share strips with their containers).
        if (
          bestTop == null ||
          (isItem && !bestIsItem) ||
          (isItem && bestIsItem &&
            Math.abs((unit.top + unit.bottom) / 2 - y) <
              Math.abs((bestTop.top + bestTop.bottom) / 2 - y))
        ) {
          bestTop = unit;
          bestIsItem = isItem;
        }
      }
    }
    return bestTop?.block ?? null;
  };

  const onMouseMove = (event: MouseEvent) => {
    if (view.isDestroyed || !view.editable) {
      hide();
      return;
    }
    if (dragActive) {
      // Pointer drag in progress — the handle's own pointer handlers drive it.
      return;
    }

    const hovered = hoveredBlock;
    const hoveredStripRect = hovered != null ? hoveredStrip(hovered) : null;
    const onHoveredLine = hoveredStripRect != null
      ? event.clientY >= hoveredStripRect.top - LINE_STICKY_TOLERANCE &&
        event.clientY <= hoveredStripRect.bottom + LINE_STICKY_TOLERANCE
      : false;
    // The zone left of the hovered unit's own content: gutter + the
    // structural strips (markers, checkbox/label columns). The handle lives
    // there, so the unit must stay grabbable across the whole zone.
    const contentLeft = hovered != null
      ? contentLeftOf(view, hovered.from, hovered.node)
      : view.dom.getBoundingClientRect().left;
    const inLeftZone = event.clientX < contentLeft;

    const posResult = view.posAtCoords({
      left: event.clientX,
      top: event.clientY,
    });

    // 1) Sticky: keep the hovered unit while the pointer is on its strip in
    //    the left zone — but only up to the left edge of its handle. Further
    //    left the unit promotes to its enclosing list, so a whole list is
    //    grabbable from the gutter (one step left of the item handle).
    if (onHoveredLine && inLeftZone) {
      const handleRect = handle.getBoundingClientRect();
      const beyondHandle = event.clientX < handleRect.left - HANDLE_STICKY_TOLERANCE;
      if (beyondHandle) {
        const enclosing = enclosingListBlock(view, hovered!);
        if (enclosing != null) {
          hoveredBlock = enclosing;
          show(enclosing);
        }
        return;
      }
      if (posResult != null) {
        const resolved = findDraggableBlock(
          view.state.doc,
          posResult.pos,
          options.excludedTypes,
          view.state,
        );
        // Only an enclosing-list resolution (the parent list of an item)
        // must not steal the hover from the item while on its line.
        const isEnclosing =
          resolved != null &&
          resolved.from < hovered!.from &&
          resolved.to >= hovered!.to;
        if (!isEnclosing) {
          hoveredBlock = resolved;
          if (resolved != null) show(resolved);
        }
      }
      return;
    }

    if (posResult == null) {
      // Gutter beyond the hovered strip: resolve a fresh unit by Y so the
      // handle appears when the gutter is entered directly (never hides on
      // the way between content and handle).
      const fresh = blockByVerticalLookup(event.clientY);
      if (fresh != null) {
        hoveredBlock = fresh;
        show(fresh);
      } else {
        hide();
      }
      return;
    }

    const block = findDraggableBlock(
      view.state.doc,
      posResult.pos,
      options.excludedTypes,
      view.state,
    );
    if (block == null) {
      hide();
      return;
    }

    // 2) Left of an item's handle → promote to the enclosing list: the whole
    //    list becomes grabbable in the gutter, one item to the left of the
    //    item handle (screenshot case: the taskList gutter).
    if (
      hovered != null &&
      DRAG_HANDLE_ITEM_TYPES.includes(hovered.node.type.name) &&
      block.from !== hovered.from &&
      block.to <= hovered.from &&
      event.clientX < contentLeft
    ) {
      hoveredBlock = block;
      show(block);
      return;
    }

    hoveredBlock = block;
    show(block);
  };

  // ── Pointer drag (Notion-style, no native HTML5 DnD) ──

  const onHandlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || hoveredBlock == null || view.isDestroyed || !view.editable) {
      return;
    }
    dragBlock = hoveredBlock;
    dragStartPoint = { x: event.clientX, y: event.clientY };
    // Capture on the handle so pointermove/up keep arriving even outside.
    try {
      handle.setPointerCapture(event.pointerId);
    } catch {
      // Some environments refuse capture — document handlers cover it.
    }
    event.preventDefault();
  };

  /** The drop target position for a pointer at (clientX, clientY).
   *
   *  Like PM's default drop, the target snaps to block boundaries via
   *  dropPoint; the raw position comes from two sources:
   *   1. posAtCoords when the pointer is over the content — the canonical
   *      path (same as editHandlers.drop);
   *   2. the gutter-fallback when posAtCoords returns null: the pointer is
   *      LEFT of the content (where the handle lives and where drags are
   *      usually held). The top-level block whose vertical strip contains
   *      the pointer Y is found geometrically (like blockByVerticalLookup,
   *      but boundaries-only and outside the dragged range: hidden blocks
   *      of collapsed sections have no box and must not become targets),
   *      and the boundary before/after it by the half of its height. */
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

    type DropTarget = { pos: number; size: number; top: number; bottom: number; isItem: boolean };
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

    const itemDomRect = (block: DraggableBlock): { top: number; bottom: number } | null => {
      // An item's own DOM rect covers its nested content too (the hidden
      // subtask list is display:none inside it) — the first LINE is the
      // grab strip, resolved like hoveredStrip.
      return hoveredStrip(block);
    };

    const collectItems = (node: PMNode, pos: number) => {
      if (
        node.type.name === 'bulletList' ||
        node.type.name === 'orderedList' ||
        node.type.name === 'taskList'
      ) {
        let itemPos = pos + 1;
        node.content.content.forEach((item) => {
          const rect = itemDomRect({ node: item, from: itemPos, to: itemPos + item.nodeSize });
          if (rect != null) {
            consider(itemPos, item.nodeSize, rect, true);
          }
          item.content.content.forEach((child, i) => {
            if (
              child.type.name === 'bulletList' ||
              child.type.name === 'orderedList' ||
              child.type.name === 'taskList'
            ) {
              collectItems(
                child,
                itemPos + 1 + item.content.content.slice(0, i).reduce((s, n) => s + n.nodeSize, 0),
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

  const onHandlePointerMove = (event: PointerEvent) => {
    if (dragBlock == null || dragStartPoint == null) {
      return;
    }
    const dx = event.clientX - dragStartPoint.x;
    const dy = event.clientY - dragStartPoint.y;
    if (!dragActive) {
      if (Math.hypot(dx, dy) < DRAG_START_THRESHOLD) {
        return;
      }
      dragActive = true;
      handle.classList.add(DRAG_HANDLE_CSS.dragging);
      // Show the drag in plugin state (drop line at the source position).
      view.dispatch(
        view.state.tr.setMeta(dragHandleKey, {
          type: 'dragStart',
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
          .setMeta(dragHandleKey, { type: 'dragMove', insertPos } satisfies DragHandleMeta)
          .setMeta('addToHistory', false),
      );
    }
  };

  const finishDrag = (event: PointerEvent, apply: boolean) => {
    if (dragBlock == null) {
      return;
    }
    const block = dragBlock;
    const wasActive = dragActive;
    dragBlock = null;
    dragStartPoint = null;
    dragActive = false;
    try {
      handle.releasePointerCapture(event.pointerId);
    } catch {
      // pointer capture may already be gone
    }
    handle.classList.remove(DRAG_HANDLE_CSS.dragging);

    if (wasActive && apply) {
      const insertPos = resolveInsertPos(block, event.clientX, event.clientY);
      // No target position (outside the editor) or a no-op drop (on the
      // dragged block itself) cancels the move.
      const insideSelf =
        insertPos != null &&
        insertPos >= block.from &&
        insertPos <= block.to;
      if (insertPos != null && !insideSelf && performBlockMove(view, block, insertPos)) {
        return;
      }
    }
    // Cancelled: clear the drag state (removes the drop line).
    view.dispatch(
      view.state.tr
        .setMeta(dragHandleKey, { type: 'dragEnd' } satisfies DragHandleMeta)
        .setMeta('addToHistory', false),
    );
  };

  const onHandlePointerUp = (event: PointerEvent) => {
    finishDrag(event, true);
  };
  const onHandlePointerCancel = (event: PointerEvent) => {
    finishDrag(event, false);
  };

  container.addEventListener('mousemove', onMouseMove);
  container.addEventListener('mouseleave', hide);
  handle.addEventListener('pointerdown', onHandlePointerDown);
  handle.addEventListener('pointermove', onHandlePointerMove);
  handle.addEventListener('pointerup', onHandlePointerUp);
  handle.addEventListener('pointercancel', onHandlePointerCancel);

  return {
    handle,
    destroy() {
      container.removeEventListener('mousemove', onMouseMove);
      container.removeEventListener('mouseleave', hide);
      handle.removeEventListener('pointerdown', onHandlePointerDown);
      handle.removeEventListener('pointermove', onHandlePointerMove);
      handle.removeEventListener('pointerup', onHandlePointerUp);
      handle.removeEventListener('pointercancel', onHandlePointerCancel);
      handle.remove();
    },
  };
}

/** Grip dot centers (viewBox 0 0 24 24) — static markup, see styles/drag-handle.css. */
const GRIP_DOT_POSITIONS: ReadonlyArray<readonly [string, string]> = [
  ['9.2', '5.5'], ['14.8', '5.5'],
  ['9.2', '12'], ['14.8', '12'],
  ['9.2', '18.5'], ['14.8', '18.5'],
];
const GRIP_DOT_RADIUS = '1.5';
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

/** Static grip markup (six dots, like tiptap's handle). */
function createHandleDom(): HTMLElement {
  const handle = createDiv();
  handle.className = DRAG_HANDLE_CSS.handle;
  handle.setAttribute('contenteditable', 'false');
  handle.setAttribute('aria-hidden', 'true');
  handle.setAttribute('data-testid', 'block-drag-handle');
  const svg = document.createElementNS(SVG_NAMESPACE, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'currentColor');
  svg.setAttribute('aria-hidden', 'true');
  for (const [cx, cy] of GRIP_DOT_POSITIONS) {
    const circle = document.createElementNS(SVG_NAMESPACE, 'circle');
    circle.setAttribute('cx', cx);
    circle.setAttribute('cy', cy);
    circle.setAttribute('r', GRIP_DOT_RADIUS);
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
 * The left edge of the unit's CONTENT (viewport x): for list/task items the
 * text start of their first line, for everything else the block's own left
 * edge. The hover-sticky left zone spans from the content edge leftwards —
 * it covers the gutter, list markers and the checkbox/label column.
 */
function contentLeftOf(view: EditorView, from: number, node: PMNode): number {
    if (DRAG_HANDLE_ITEM_TYPES.includes(node.type.name)) {
      const block: DraggableBlock = { node, from, to: from + node.nodeSize };
      const textPos = firstTextPos(block);
      if (textPos != null) {
        try {
          const coords = view.coordsAtPos(textPos);
          if (Number.isFinite(coords.left)) {
            return coords.left;
          }
        } catch {
          // fall through to the block DOM rect
        }
      }
    } else {
      try {
        const coords = view.coordsAtPos(from + 1);
        if (Number.isFinite(coords.left)) {
          return coords.left;
        }
      } catch {
        // fall through to the block DOM rect
      }
    }
    const dom = blockDomAt(view, from);
    return dom != null ? dom.getBoundingClientRect().left : view.dom.getBoundingClientRect().left;
  }

/** Leftmost x of the fold chevrons inside the block's DOM, if any (viewport). */
function gutterControlsLeft(blockDom: Element, blockRectLeft: number): number {
  let left = blockRectLeft;
  for (const className of DRAG_HANDLE_CSS.gutterControls) {
    for (const el of blockDom.querySelectorAll(`.${className}`)) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) {
        continue;
      }
      left = Math.min(left, rect.left);
    }
  }
  return left;
}

/**
 * Position the handle next to the dragged unit's first text line, in the
 * container's content coordinates (absolute positioning inside a scroll
 * container lives in content space, so the handle stays glued while
 * scrolling).
 *
 *  - Height/top follow the unit's first line (caret rect via coordsAtPos),
 *    so the handle is exactly as tall as a text line and vertically
 *    centered on it; non-text units fall back to the default height.
 *  - Left clears the fold chevrons (heading/task folding) that live in the
 *    same gutter, so the two never overlap.
 */
function positionHandle(
  view: EditorView,
  handle: HTMLElement,
  block: DraggableBlock,
  container: HTMLElement,
): void {
  const { from, node } = block;
  const blockDom = blockDomAt(view, from);
  if (blockDom == null) {
    return;
  }

  const containerRect = container.getBoundingClientRect();
  const toContentY = (viewportY: number) =>
    viewportY - containerRect.top + container.scrollTop;

  // First line of the unit: caret rect of its first text content. For
  // list/task items the caret at the unit start is degenerate (their
  // label/checkbox is contenteditable=false), so resolve the first
  // paragraph's inner position — the same rule as hoveredStrip.
  let top: number;
  let height: number;
  try {
    const textPos = firstTextPos(block);
    const coordsPos = textPos != null ? textPos : from + 1;
    const coords = view.coordsAtPos(coordsPos);
    height = Math.max(
      coords.bottom - coords.top,
      HANDLE_MIN_HEIGHT,
    );
    // Center on the first line even when the minimum height wins.
    top = toContentY((coords.top + coords.bottom) / 2 - height / 2);
    if (!Number.isFinite(top) || !Number.isFinite(height) || height <= 0) {
      throw new Error('invalid caret rect');
    }
  } catch {
    const blockRect = blockDom.getBoundingClientRect();
    top = toContentY(blockRect.top);
    height = HANDLE_DEFAULT_HEIGHT;
  }

  // Left: a stable base per unit kind so the handle never shifts between
  // neighbors and always clears the surrounding chrome:
  //  - units inside (or being) a list anchor to the list's left edge —
  //    markers and the checkbox/label column live in its padding;
  //  - task lists additionally reserve the fold-chevron strip, so the
  //    handle sits just left of it for EVERY item of the list (foldable or
  //    not) and the whole-list handle lands at the same X as item handles
  //    (no jump on list promotion);
  //  - other blocks keep their own left edge, cleared of fold chevrons.
  const blockRect = blockDom.getBoundingClientRect();
  let base = blockRect.left;
  const isItem = DRAG_HANDLE_ITEM_TYPES.includes(node.type.name);
  const isListNode = node.type.name.endsWith('List');
  const listBlock = isItem
    ? enclosingListBlock(view, block)
    : isListNode
      ? block
      : null;
  const listDom = listBlock != null ? blockDomAt(view, listBlock.from) : null;
  if (listDom != null) {
    const chevronZone = listBlock!.node.type.name === 'taskList'
      ? TASK_CHEVRON_ZONE
      : 0;
    base = Math.min(base, listDom.getBoundingClientRect().left - chevronZone);
  }
  base = Math.min(base, gutterControlsLeft(blockDom, blockRect.left));
  const left = base - HANDLE_GAP - HANDLE_WIDTH;

  handle.style.top = `${top}px`;
  handle.style.left = `${left - containerRect.left + container.scrollLeft}px`;
  handle.style.height = `${height}px`;
}
