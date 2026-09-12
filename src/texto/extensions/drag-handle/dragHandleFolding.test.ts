import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '../../core/Editor';
import type { JSONContent } from '../../core/@types';
import { getExtensions } from '../../getExtensions';
import { findDraggableBlock, performBlockMove } from './dragHandlePlugin';
import { headingFoldingKey } from '../heading/foldingPlugin';
import { taskFoldingKey } from '../task-item-folding/taskFoldingPlugin';

function doc(): JSONContent {
  return {
    type: 'noteDoc',
    content: [
      { type: 'noteTitle', content: [{ type: 'text', text: 'Title' }] },
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'H1 one' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'body of one' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'more of one' }] },
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'H1 two' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'body of two' }] },
      {
        type: 'taskList',
        content: [
          {
            type: 'taskItem', attrs: { checked: false },
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'parent task' }] },
              {
                type: 'taskList',
                content: [
                  { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'sub' }] }] },
                ],
              },
            ],
          },
          { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'plain task' }] }] },
        ],
      },
    ],
  };
}

const fixtures: { editor: Editor; el: HTMLElement }[] = [];
function useFixture() {
  const el = createDiv();
  document.body.appendChild(el);
  const editor = new Editor({ element: el, content: doc(), extensions: getExtensions({}, {}), editable: true });
  fixtures.push({ editor, el });
  return editor;
}
afterEach(() => { for (const f of fixtures.splice(0)) { f.editor.destroy(); f.el.remove(); } });

const positionsOf = (editor: Editor) => {
  const positions: number[] = [];
  editor.state.doc.forEach((_, pos) => positions.push(pos));
  return positions;
};
const headingFolds = (view: Editor['view']) =>
  Array.from(headingFoldingKey.getState(view.state)!.folded).sort((a, b) => a - b);
const taskFolds = (view: Editor['view']) =>
  Array.from(taskFoldingKey.getState(view.state)!.folded).sort((a, b) => a - b);

describe('dragging collapsed blocks', () => {
  it('a collapsed heading resolves to the whole section (heading + hidden body)', () => {
    const editor = useFixture();
    const view = editor.view;
    const positions = positionsOf(editor);

    view.dispatch(view.state.tr.setMeta(headingFoldingKey, { type: 'fold', pos: positions[1] }));
    // Position inside the heading and inside the hidden body both resolve
    // to the section.
    const fromHeading = findDraggableBlock(view.state.doc, positions[1] + 2, undefined, view.state)!;
    const fromBody = findDraggableBlock(view.state.doc, positions[2] + 2, undefined, view.state)!;
    const fromHiddenTail = findDraggableBlock(view.state.doc, positions[3] + 2, undefined, view.state)!;

    for (const block of [fromHeading, fromBody, fromHiddenTail]) {
      expect(block.node.type.name).toBe('heading');
      expect(block.node.textContent).toBe('H1 one');
      expect(block.from).toBe(positions[1]);
      // to covers: heading + 'body of one' + 'more of one'
      expect(block.to).toBe(positions[4]);
    }
  });

  it('an unfolded heading still drags as just the heading', () => {
    const editor = useFixture();
    const positions = positionsOf(editor);
    const block = findDraggableBlock(editor.state.doc, positions[1] + 2, undefined, editor.state)!;
    expect(block.node.type.name).toBe('heading');
    expect(block.from).toBe(positions[1]);
    expect(block.to).toBe(positions[2]);
  });

  it('moves the collapsed section as a whole and keeps the fold', () => {
    const editor = useFixture();
    const view = editor.view;
    const positions = positionsOf(editor);

    view.dispatch(view.state.tr.setMeta(headingFoldingKey, { type: 'fold', pos: positions[1] }));
    const block = findDraggableBlock(view.state.doc, positions[1] + 2, undefined, view.state)!;
    // Drop AFTER the second section (before the taskList).
    const moved = performBlockMove(view, block, positions[6]);

    expect(moved).toBe(true);
    const after = view.state.doc;
    const texts = after.content.content.map((n) => n.textContent);
    // New order: title, 'H1 two' section, THEN the whole 'H1 one' section
    // (heading + both hidden paragraphs), then the taskList.
    expect(texts).toEqual([
      'Title',
      'H1 two',
      'body of two',
      'H1 one',
      'body of one',
      'more of one',
      'parent tasksubplain task',
    ]);
    // The fold moved with the section: it now points at 'H1 one' in the
    // NEW doc (after 'H1 two' + its body).
    const folds = headingFolds(view);
    expect(folds.length).toBe(1);
    expect(after.nodeAt(folds[0])?.type.name).toBe('heading');
    expect(after.nodeAt(folds[0])?.textContent).toBe('H1 one');
  });

  it('a collapsed heading nested in another section: inner fold maps, outer kept', () => {
    const editor = useFixture();
    const view = editor.view;
    const positions = positionsOf(editor);
    // Fold only 'H1 two' and move the FIRST section (not folded).
    view.dispatch(view.state.tr.setMeta(headingFoldingKey, { type: 'fold', pos: positions[4] }));
    const block = findDraggableBlock(view.state.doc, positions[1] + 2, undefined, view.state)!;
    expect(block.to).toBe(positions[2]); // unfolded section: heading only

    const moved = performBlockMove(view, block, positions[6]);
    expect(moved).toBe(true);
    const folds = headingFolds(view);
    expect(folds.length).toBe(1);
    expect(view.state.doc.nodeAt(folds[0])?.textContent).toBe('H1 two');
  });

  it('a folded task item keeps its fold when moved inside the list', () => {
    const editor = useFixture();
    const view = editor.view;
    const positions = positionsOf(editor);
    const taskListPos = positions[6];
    const parentFrom = taskListPos + 1;

    view.dispatch(view.state.tr.setMeta(taskFoldingKey, { type: 'fold', pos: parentFrom }));
    expect(taskFolds(view)).toEqual([parentFrom]);

    const block = findDraggableBlock(view.state.doc, parentFrom + 2)!;
    expect(block.node.textContent).toBe('parent tasksub');
    // Move the parent item below 'plain task'.
    const parentSize = block.node.nodeSize;
    const plainFrom = parentFrom + parentSize;
    const plain = view.state.doc.nodeAt(plainFrom)!;
    const dropPos = plainFrom + plain.nodeSize;

    const moved = performBlockMove(view, block, dropPos);
    expect(moved).toBe(true);

    const list = view.state.doc.content.content.find((n) => n.type.name === 'taskList')!;
    expect(list.textContent).toBe('plain taskparent tasksub');
    // The fold followed the item to its new position.
    const folds = taskFolds(view);
    expect(folds.length).toBe(1);
    const foldedNode = view.state.doc.nodeAt(folds[0])!;
    expect(foldedNode.type.name).toBe('taskItem');
    expect(foldedNode.textContent).toBe('parent tasksub');
  });

  it('a folded task item moved to the doc level keeps its fold (wrapped)', () => {
    const editor = useFixture();
    const view = editor.view;
    const positions = positionsOf(editor);
    const taskListPos = positions[6];
    const parentFrom = taskListPos + 1;

    view.dispatch(view.state.tr.setMeta(taskFoldingKey, { type: 'fold', pos: parentFrom }));

    const block = findDraggableBlock(view.state.doc, parentFrom + 2)!;
    // Drop before the first heading (doc level): the item wraps into a new
    // taskList and the emptied source list keeps 'plain task'.
    const moved = performBlockMove(view, block, positions[1]);
    expect(moved).toBe(true);

    const after = view.state.doc;
    const texts = after.content.content.map((n) => n.textContent);
    // The wrapped item landed right after the title, shifting the rest.
    expect(texts[0]).toBe('Title');
    expect(texts[1]).toBe('parent tasksub'); // wrapped into a new taskList
    expect(texts[2]).toBe('H1 one');
    expect(texts[3]).toBe('body of one');
    expect(texts[4]).toBe('more of one');
    expect(texts[5]).toBe('H1 two');
    expect(texts[6]).toBe('body of two');
    expect(texts[7]).toBe('plain task'); // source list trimmed to one item

    const folds = taskFolds(view);
    expect(folds.length).toBe(1);
    const foldedNode = after.nodeAt(folds[0])!;
    expect(foldedNode.type.name).toBe('taskItem');
    expect(foldedNode.textContent).toBe('parent tasksub');
  });
});
