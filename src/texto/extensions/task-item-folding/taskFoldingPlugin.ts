import type { Node as ProseMirrorNode, ResolvedPos } from 'prosemirror-model';
import {
  Plugin,
  PluginKey,
  Selection,
  type EditorState,
  type Transaction,
} from 'prosemirror-state';
import { Decoration, DecorationSet } from 'prosemirror-view';

/**
 * Task item folding — collapse the nested content (subtasks) of a task item,
 * modeled directly on the heading folding plugin (see
 * ../heading/foldingPlugin.ts) and https://prosemirror.net/examples/fold/.
 *
 * Same design decisions as heading folding:
 *  - The document is NEVER mutated: folded content stays in the doc and is
 *    hidden with node decorations (`display:none`).
 *  - Fold state lives in this plugin. Persistence is host-side: the
 *    TaskItemFolding extension mirrors the current positions into
 *    editor.storage.taskItemFolding.positions on every transaction; the host
 *    (NoteView) saves them to a separate localStorage key.
 *
 * Differences from heading folding:
 *  - A task item's foldable "body" is every block child after its first
 *    paragraph (with nested task lists enabled that is the subtask list).
 *  - No chevron widget decoration: the task item already has a custom node
 *    view (texto-extension-task-item) which renders the chevron in its label.
 *    The folded state reaches the node view as an `is-folded` node decoration
 *    on the item (ProseMirror applies outer node decorations to custom node
 *    view DOM, see ViewDesc.updateOuterDeco).
 */

export const taskFoldingKey = new PluginKey<TaskFoldingState>(
  'inscriptumTaskFolding',
);

export type TaskFoldingMeta =
  | { type: 'toggle'; pos: number }
  | { type: 'fold'; pos: number }
  | { type: 'unfold'; pos: number }
  | { type: 'restore'; positions: number[] }
  /** Complete replacement of the fold set for one transaction: positions
   *  are already computed against the transaction's NEW doc. Sent by the
   *  drag & drop block move (see extensions/drag-handle) — a move deletes
   *  the folded unit and re-inserts it elsewhere, which plain position
   *  mapping cannot follow. */
  | { type: 'setFolds'; positions: number[] };

export interface TaskFoldingState {
  /** Positions (doc offsets, before the node) of folded task items. */
  folded: Set<number>;
}

export interface TaskSectionRange {
  /** Position of the task item node. */
  itemPos: number;
  /** End of the task item node. */
  itemEnd: number;
  /** Range of the nested content (all children after the first paragraph),
   *  null when there is nothing to fold. */
  body: { from: number; to: number } | null;
}

/** CSS classes used by the decorations (see styles/heading-folding.css and
 *  styles/task-item.css). Reuses the heading folding class names. */
export const TASK_FOLDING_CSS = {
  itemCollapsed: 'is-folded',
  contentHidden: 'texto-folded-content',
  /** Layout class on the chevron span rendered by the item node view. */
  chevron: 'texto-task-fold-chevron',
} as const;

export interface TaskFoldingPluginOptions {
  taskItemTypeName: string;
}

export function createTaskFoldingPlugin(
  options: TaskFoldingPluginOptions,
): Plugin<TaskFoldingState> {
  const { taskItemTypeName } = options;

  return new Plugin<TaskFoldingState>({
    key: taskFoldingKey,

    state: {
      init: (): TaskFoldingState => ({ folded: new Set() }),

      apply(tr, value): TaskFoldingState {
        const meta = tr.getMeta(taskFoldingKey) as TaskFoldingMeta | undefined;

        // setFolds: the sender already mapped every fold against this
        // transaction's new doc — skip the generic remap below, which
        // cannot follow content that was deleted and re-inserted
        // elsewhere (the drag & drop block move).
        if (meta?.type === 'setFolds') {
          const next = new Set<number>();
          for (const pos of meta.positions) {
            const node = tr.doc.nodeAt(pos);
            if (
              node != null &&
              node.type.name === taskItemTypeName &&
              node.childCount > 1
            ) {
              next.add(pos);
            }
          }
          return { folded: next };
        }

        let folded = value.folded;

        // Map positions through the transaction (keeps folds while editing).
        // mapResult (not map): when the mapped-from range was deleted the
        // result is flagged `deleted` — the folded node is gone, so the fold
        // must be dropped. Plain `map(pos, -1)` would return the position of
        // the *next* node and silently transfer the fold onto it (deleting a
        // folded item then folded its next sibling).
        if (tr.docChanged) {
          const next = new Set<number>();
          for (const pos of folded) {
            const result = tr.mapping.mapResult(pos);
            if (result.deleted) {
              continue;
            }
            const node = tr.doc.resolve(result.pos).nodeAfter;
            // Drop folds whose task item is no longer an item (e.g. lifted),
            // or no longer has a nested body to hide (e.g. Enter moved the
            // subtasks to the new item — keeping the fold would collapse
            // nothing yet persist as an invisible no-op).
            if (
              node != null &&
              node.type.name === taskItemTypeName &&
              node.childCount > 1
            ) {
              next.add(result.pos);
            }
          }
          folded = next;
        }

        if (meta != null) {
          const next = new Set(folded);
          if (meta.type === 'toggle') {
            if (next.has(meta.pos)) {
              next.delete(meta.pos);
            } else {
              next.add(meta.pos);
            }
          } else if (meta.type === 'fold') {
            next.add(meta.pos);
          } else if (meta.type === 'unfold') {
            next.delete(meta.pos);
          } else if (meta.type === 'restore') {
            for (const pos of meta.positions) {
              // Only items that still have a nested body — a restore onto a
              // body-less item would persist as an invisible no-op fold.
              const node = tr.doc.nodeAt(pos);
              if (
                node != null &&
                node.type.name === taskItemTypeName &&
                node.childCount > 1
              ) {
                next.add(pos);
              }
            }
          }
          folded = next;
        }

        if (folded === value.folded) {
          return value;
        }

        return { folded };
      },
    },

    props: {
      decorations(state: EditorState): DecorationSet {
        const pluginState = taskFoldingKey.getState(state);
        if (pluginState == null) {
          return DecorationSet.empty;
        }
        return buildFoldDecorations(state, pluginState, taskItemTypeName);
      },
    },

    appendTransaction(
      transactions: readonly Transaction[],
      _oldState: EditorState,
      newState: EditorState,
    ): Transaction | null {
      const pluginState = taskFoldingKey.getState(newState);
      if (pluginState == null || pluginState.folded.size === 0) {
        return null;
      }

      // The caret must never end up inside a hidden region. Folding with the
      // caret inside the body is one path; edits can also move it there —
      // e.g. sinking the next item with Tab under a folded parent — so any
      // transaction that moved the selection is checked while folds exist.
      const foldMeta = transactions.some(
        (tr) => tr.getMeta(taskFoldingKey) != null,
      );
      const selectionMoved = transactions.some(
        (tr) => tr.docChanged || tr.selectionSet,
      );
      if (!foldMeta && !selectionMoved) {
        return null;
      }

      // Push the caret out of the hidden region — back into the task
      // item's own paragraph (the item stays visible and editable).
      //
      // Only an empty caret inside the nested content, or a selection
      // entirely contained in it, is pushed out. A selection that merely
      // OVERLAPS it (Cmd+A selectAll) is deliberate and must be preserved:
      // forcing it back into the paragraph made Cmd+A silently collapse
      // to a caret while any fold existed. Containment (not "covers item
      // AND body") because a TextSelection often cannot reach bodyTo at
      // all — e.g. a folded item whose body ends in a nested list — so a
      // reach check would misfire exactly like the old overlap check.
      const sections = collectTaskSections(newState.doc, taskItemTypeName);
      const { selection } = newState;
      let target: number | null = null;

      for (const section of sections) {
        if (!pluginState.folded.has(section.itemPos) || section.body == null) {
          continue;
        }
        const { from: bodyFrom, to: bodyTo } = section.body;
        const overlaps = selection.to > bodyFrom && selection.from < bodyTo;
        if (!overlaps) {
          continue;
        }
        const entirelyInside =
          selection.from >= bodyFrom && selection.to <= bodyTo;
        if (!selection.empty && !entirelyInside) {
          // Overlapping but sticking out (e.g. selectAll) — keep it.
          continue;
        }
        target = section.body.from;
        break;
      }

      if (target == null) {
        return null;
      }

      // bias -1: resolve back into the item's own paragraph, not forward into
      // the (now hidden) nested content.
      const next = Selection.near(newState.doc.resolve(target), -1);
      if (next.eq(selection)) {
        return null;
      }

      const tr = newState.tr;
      tr.setSelection(next).setMeta('addToHistory', false);
      return tr;
    },
  });
}

/**
 * Enter at the end of a folded task item's own text — mirror the heading
 * folding behavior: unfold the item and put the new line AFTER the (now
 * visible) nested content, not inside the hidden region.
 *
 * A plugin with handleKeyDown (not an addKeyboardShortcuts Enter binding):
 * the taskItem extension binds Enter to splitListItem, which must keep
 * handling every other Enter inside a task item; this plugin intercepts
 * only the one case it owns and returns false otherwise. Plugin order:
 * TaskItemFolding sorts after TaskItem in getExtensions, so its plugins
 * sit BEFORE TaskItem's keymap plugin in the final list and see Enter
 * first (ProseMirror asks handleKeyDown plugins in list order).
 */
export function createTaskFoldKeymapPlugin(
  options: TaskFoldingPluginOptions,
): Plugin {
  const { taskItemTypeName } = options;

  return new Plugin({
    key: taskFoldKeymapKey,

    props: {
      handleKeyDown(view, event) {
        if (event.key !== 'Enter') {
          return false;
        }
        // Plain Enter only: Shift-Enter (hard break) etc. stay with the
        // core chain.
        if (event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) {
          return false;
        }

        const { state } = view;
        const { selection } = state;
        if (!selection.empty) {
          return false;
        }

        const pluginState = taskFoldingKey.getState(state);
        if (pluginState == null || pluginState.folded.size === 0) {
          return false;
        }

        // The caret must sit at the end of a folded item's own paragraph.
        const $anchor = selection.$anchor;
        const itemPos = findTaskItemPos($anchor, taskItemTypeName);
        if (itemPos == null || !pluginState.folded.has(itemPos)) {
          return false;
        }

        const itemNode = state.doc.nodeAt(itemPos);
        if (itemNode == null || itemNode.type.name !== taskItemTypeName) {
          return false;
        }

        // The caret must sit at the END of the item's own first
        // paragraph (right before the hidden nested content) — not
        // anywhere else in the item.
        const ownPara = itemNode.child(0);
        if (
          $anchor.parent !== ownPara ||
          $anchor.parentOffset !== ownPara.content.size
        ) {
          return false;
        }

        const section = collectTaskSections(state.doc, taskItemTypeName).find(
          (s) => s.itemPos === itemPos,
        );
        if (section == null || section.body == null) {
          return false;
        }

        const tr = state.tr;
        // 1. Unfold on the same transaction — the meta hook drops the fold
        //    so the nested content is visible again in the final state.
        tr.setMeta(taskFoldingKey, {
          type: 'unfold',
          pos: itemPos,
        } satisfies TaskFoldingMeta);

        // 2. Insert a new empty task item right AFTER the folded item
        //    (a sibling in the same taskList): the revealed nested content
        //    stays with the first item, and the new line appears at the
        //    end of the revealed block — heading-folding parity.
        //    (tr.split cannot be used: bodyTo sits inside the item where a
        //    depth-2 split would try to join the taskList onto a taskItem.)
        const itemType = state.schema.nodes[taskItemTypeName];
        const paragraphType = state.schema.nodes.paragraph;
        if (itemType == null || paragraphType == null) {
          return false;
        }
        const itemEnd = itemPos + itemNode.nodeSize;
        const $at = tr.doc.resolve(itemEnd);
        const newItem = itemType.create(
          { checked: false },
          [paragraphType.create()],
        );
        if (
          !$at.parent.canReplaceWith(
            $at.index(),
            $at.index(),
            itemType,
          )
        ) {
          return false;
        }
        tr.insert(itemEnd, newItem);

        // Caret into the new item's paragraph (itemEnd + 1 opens the item,
        // +1 more lands inside its paragraph content).
        const $target = tr.doc.resolve(itemEnd + 2);
        tr.setSelection(Selection.near($target));
        tr.scrollIntoView();

        view.dispatch(tr);
        return true;
      },
    },
  });
}

/** Find the task item position for a resolved position (nearest taskItem
 *  ancestor, top-down within a task list). */
function findTaskItemPos(
  $pos: ResolvedPos,
  taskItemTypeName: string,
): number | null {
  for (let depth = $pos.depth; depth >= 1; depth -= 1) {
    if ($pos.node(depth).type.name === taskItemTypeName) {
      return $pos.before(depth);
    }
  }
  return null;
}

/** Plugin key for the Enter-at-folded-task-item keymap plugin. */
export const taskFoldKeymapKey = new PluginKey(
  'inscriptumTaskFoldKeymap',
);

/** Build fold/hide node decorations for the fold state. */
function buildFoldDecorations(
  state: EditorState,
  pluginState: TaskFoldingState,
  taskItemTypeName: string,
): DecorationSet {
  const decorations: Decoration[] = [];
  const doc = state.doc;
  const folded = pluginState.folded;

  const sections = collectTaskSections(doc, taskItemTypeName);

  for (const section of sections) {
    if (!folded.has(section.itemPos)) {
      continue;
    }

    // `is-folded` on the item: the custom node view host gets the class
    // (outer node decorations are applied by ViewDesc.updateOuterDeco),
    // CSS rotates the chevron rendered inside the item's label.
    decorations.push(
      Decoration.node(
        section.itemPos,
        section.itemEnd,
        { class: TASK_FOLDING_CSS.itemCollapsed },
        { taskFold: true },
      ),
    );

    if (section.body == null) {
      continue;
    }

    const { from: bodyFrom, to: bodyTo } = section.body;
    // Hide every top-level block of the nested content. Note: nodesBetween
    // walks top-down and starts at ancestors that begin BEFORE bodyFrom, so
    // the callback must not prune descent there (unlike the heading plugin,
    // where body blocks are direct children of the doc).
    doc.nodesBetween(bodyFrom, bodyTo, (node, pos) => {
      if (
        node.isBlock &&
        pos >= bodyFrom &&
        pos + node.nodeSize <= bodyTo
      ) {
        decorations.push(
          Decoration.node(
            pos,
            pos + node.nodeSize,
            { class: TASK_FOLDING_CSS.contentHidden },
            { taskFoldContent: true },
          ),
        );
        // Top-most hidden block: don't descend into its children.
        return false;
      }
      return true;
    });
  }

  return DecorationSet.create(doc, decorations);
}

/**
 * Collect all foldable task items: each item that has block children after
 * its first paragraph (i.e. nested content), plus the nested content range.
 */
export function collectTaskSections(
  doc: ProseMirrorNode,
  taskItemTypeName: string,
): TaskSectionRange[] {
  const sections: TaskSectionRange[] = [];

  doc.descendants((node, pos) => {
    if (node.type.name !== taskItemTypeName || node.childCount < 2) {
      return true;
    }

    // Content starts at pos + 1; the first child is the item's own paragraph.
    const bodyFrom = pos + 1 + node.child(0).nodeSize;
    const bodyTo = pos + node.nodeSize - 1;

    sections.push({
      itemPos: pos,
      itemEnd: pos + node.nodeSize,
      body: bodyFrom < bodyTo ? { from: bodyFrom, to: bodyTo } : null,
    });

    // Keep descending: sections of items nested inside other items'
    // bodies are independent — folding a parent hides the whole subtree
    // via the parent's own decorations, and a child's own fold survives
    // the parent being unfolded again.
    return true;
  });

  return sections;
}

/** Current folded task item positions (for persistence). */
export function getFoldedTaskPositions(state: EditorState): number[] {
  const pluginState = taskFoldingKey.getState(state);
  return pluginState ? Array.from(pluginState.folded) : [];
}

/** Dispatch a restore meta with the given task item positions. */
export function restoreFoldedTasks(
  view: { state: EditorState; dispatch: (tr: Transaction) => void },
  positions: number[],
): void {
  const meta: TaskFoldingMeta = { type: 'restore', positions };
  view.dispatch(view.state.tr.setMeta(taskFoldingKey, meta));
}
