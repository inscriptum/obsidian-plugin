import type { Node as PMNode } from 'prosemirror-model';
import { dropPoint } from 'prosemirror-transform';
import { NodeSelection, Plugin, PluginKey, Selection } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';

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
 *    a source list emptied by the move disappears (deleteSelection trims it);
 *  - everything else drags as the whole top-level block.
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

/**
 * The draggable unit at the given doc position:
 *  - a position inside a list/task item resolves to that individual item;
 *  - any other nested structure (table cell, blockquote) resolves up to
 *    the whole top-level block;
 *  - a position on the border between two top-level blocks picks the
 *    following one (or the last block at doc end).
 */
export function findDraggableBlock(
  doc: PMNode,
  pos: number,
  excludedTypes: readonly string[] = DRAG_HANDLE_EXCLUDED_TYPES,
): DraggableBlock | null {
  if (pos < 0 || pos > doc.content.size) {
    return null;
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

  return { node, from, to: from + node.nodeSize };
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
  _dataTransfer: DataTransfer | null,
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

/**
 * Apply the block move — the same steps as ProseMirror's default drop
 * (editHandlers.drop): snap with dropPoint, delete the source selection,
 * insert the slice at the mapped position, then set the selection to the
 * inserted node.
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

  // Move semantics (like `view.dragging = { slice, move: true }`): select
  // the dragged unit and delete it — deleteSelection trims empty ancestors
  // (a source list emptied by the move disappears).
  tr.setSelection(NodeSelection.create(doc, block.from));
  tr.deleteSelection();

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

  tr.setMeta(dragHandleKey, { type: 'dragEnd' } satisfies DragHandleMeta);
  view.focus();
  view.dispatch(tr);
  return true;
}

export interface DragHandlePluginOptions {
  excludedTypes: readonly string[];
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
      apply(tr, value): DragHandleState {
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
          const block = {
            node: tr.doc.nodeAt(fromResult.pos)!,
            from: fromResult.pos,
            to: fromResult.pos + tr.doc.nodeAt(fromResult.pos)!.nodeSize,
          };
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
          // always see what is being carried and where it will land.
          Decoration.node(
            drag.block.from,
            drag.block.to,
            { class: DRAG_HANDLE_CSS.dragSource },
          ),
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
   *  Items are collected at EVERY nesting level (subtasks included). */
  const blockByVerticalLookup = (y: number): DraggableBlock | null => {
    const doc = view.state.doc;
    const units: { block: DraggableBlock; top: number; bottom: number }[] = [];

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
        units.push({
          block: { node, from: pos, to: pos + node.nodeSize },
          top: rect.top,
          bottom: rect.bottom,
        });
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

  const resolveInsertPos = (
    block: DraggableBlock,
    clientX: number,
    clientY: number,
  ): number | null => {
    const posResult = view.posAtCoords({ left: clientX, top: clientY });
    if (posResult == null) {
      return null;
    }
    const doc = view.state.doc;
    const slice = doc.slice(block.from, block.to);
    // Same snap as PM's default drop: block boundaries via dropPoint.
    return dropPoint(doc, posResult.pos, slice);
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
    if (dragActive) {
      dragActive = false;
    }
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
      if (insertPos != null && !insideSelf) {
        performBlockMove(view, block, insertPos);
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
