import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '../../core/Editor';
import type { JSONContent } from '../../core/@types';
import { getExtensions } from '../../getExtensions';
import { VIEW_TAG } from '../task-item/task-item';
import {
  collectTaskSections,
  getFoldedTaskPositions,
  taskFoldingKey,
  type TaskFoldingMeta,
} from './taskFoldingPlugin';

/**
 * Test document:
 *
 *   noteTitle
 *   taskList
 *     taskItem "parent one"     <- foldable (body: nested taskList with "child one", "child two")
 *       taskList
 *         taskItem "child one"
 *         taskItem "child two"
 *     taskItem "plain"          <- not foldable (no nested content)
 *     taskItem "parent two"     <- foldable (body: nested taskList with "child three")
 *       taskList
 *         taskItem "child three"
 */
function taskItem(text: string, children?: JSONContent[]): JSONContent {
  const content: JSONContent[] = [
    { type: 'paragraph', content: [{ type: 'text', text }] },
  ];
  if (children) content.push(...children);
  return { type: 'taskItem', attrs: { checked: false }, content };
}

function subList(...items: JSONContent[]): JSONContent {
  return { type: 'taskList', content: items };
}

function testContent(): JSONContent {
  return {
    type: 'noteDoc',
    content: [
      { type: 'noteTitle', content: [] },
      {
        type: 'taskList',
        content: [
          taskItem('parent one', [
            subList(taskItem('child one'), taskItem('child two')),
          ]),
          taskItem('plain'),
          taskItem('parent two', [subList(taskItem('child three'))]),
        ],
      },
    ],
  };
}

function createEditor(content: JSONContent = testContent()) {
  const el = document.body.appendChild(createDiv());
  const editor = new Editor({
    element: el,
    content,
    extensions: getExtensions(),
    editable: true,
  });

  const items: number[] = [];
  // Top-level task items of the first task list only (not nested children).
  editor.state.doc.forEach((node, offset) => {
    if (node.type.name !== 'taskList') return;
    node.forEach((item, itemOffset) => {
      if (item.type.name === 'taskItem') items.push(offset + 1 + itemOffset);
    });
  });

  return {
    editor,
    el,
    items,
    dispose: () => {
      editor.destroy();
      el.remove();
    },
  };
}

function dispatchFoldMeta(editor: Editor, meta: TaskFoldingMeta) {
  editor.view.dispatch(editor.state.tr.setMeta(taskFoldingKey, meta));
}

const cleanup: Array<() => void> = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()?.();
});

describe('collectTaskSections', () => {
  it('collects only items with nested content, with the body after the first paragraph', () => {
    const { editor, items, dispose } = createEditor();
    cleanup.push(dispose);

    const sections = collectTaskSections(editor.state.doc, 'taskItem');
    expect(sections.length).toBe(2);
    expect(sections[0].itemPos).toBe(items[0]);
    expect(sections[0].body).not.toBeNull();
    expect(sections[1].itemPos).toBe(items[2]);
    expect(sections[1].body).not.toBeNull();
    // items[1] ("plain") has no section
    expect(sections.some((s) => s.itemPos === items[1])).toBe(false);
  });

  it('body covers exactly the nested list', () => {
    const { editor, items, dispose } = createEditor();
    cleanup.push(dispose);

    const sections = collectTaskSections(editor.state.doc, 'taskItem');
    const body = sections[0].body!;
    const nested = editor.state.doc.nodeAt(body.from);
    expect(nested?.type.name).toBe('taskList');
    expect(body.to).toBe(items[0] + editor.state.doc.nodeAt(items[0])!.nodeSize - 1);
  });
});

describe('task folding plugin', () => {
  it('toggle hides the nested content with decorations and marks the item is-folded', () => {
    const { editor, items, dispose } = createEditor();
    cleanup.push(dispose);

    dispatchFoldMeta(editor, { type: 'toggle', pos: items[0] });

    expect(getFoldedTaskPositions(editor.state)).toEqual([items[0]]);

    const decorations = taskFoldingKey
      .getState(editor.state)!
      .folded;
    expect(decorations.has(items[0])).toBe(true);

    // DOM evidence: nested list hidden, item host has is-folded
    const host = editor.view.dom.querySelector(VIEW_TAG);
    expect(host?.classList.contains('is-folded')).toBe(true);
    const nestedList = host?.querySelector('ul[data-type="taskList"]');
    expect(nestedList?.classList.contains('texto-folded-content')).toBe(true);
  });

  it('second toggle unfolds', () => {
    const { editor, items, dispose } = createEditor();
    cleanup.push(dispose);

    dispatchFoldMeta(editor, { type: 'toggle', pos: items[0] });
    dispatchFoldMeta(editor, { type: 'toggle', pos: items[0] });

    expect(getFoldedTaskPositions(editor.state)).toEqual([]);
    const host = editor.view.dom.querySelector(VIEW_TAG);
    expect(host?.classList.contains('is-folded')).toBe(false);
  });

  it('folds survive document edits through position mapping', () => {
    const { editor, items, dispose } = createEditor();
    cleanup.push(dispose);

    dispatchFoldMeta(editor, { type: 'fold', pos: items[0] });

    // Insert a paragraph before the task list: all item positions shift.
    editor.commands.insertContentAt(1, {
      type: 'paragraph',
      content: [{ type: 'text', text: 'intro' }],
    });

    const folded = getFoldedTaskPositions(editor.state);
    expect(folded.length).toBe(1);
    expect(folded[0]).toBeGreaterThan(items[0]);
    // The folded position still points at a task item (the first one).
    expect(editor.state.doc.nodeAt(folded[0])?.type.name).toBe('taskItem');
  });

  it('drops folds when the folded item is deleted', () => {
    const { editor, items, dispose } = createEditor();
    cleanup.push(dispose);

    dispatchFoldMeta(editor, { type: 'fold', pos: items[0] });

    // Delete the whole task list (from title end to doc end).
    const from = 2;
    const to = editor.state.doc.content.size;
    editor.commands.deleteRange({ from, to });

    expect(getFoldedTaskPositions(editor.state)).toEqual([]);
  });

  it('pushes the caret out of the hidden region on fold', () => {
    const { editor, items, dispose } = createEditor();
    cleanup.push(dispose);

    // Caret inside the nested content ("child one").
    const sections = collectTaskSections(editor.state.doc, 'taskItem');
    const bodyFrom = sections[0].body!.from;
    editor.commands.setTextSelection(bodyFrom + 3);
    const inside = editor.state.selection.from;

    dispatchFoldMeta(editor, { type: 'toggle', pos: items[0] });

    const { from, to } = editor.state.selection;
    const body = collectTaskSections(editor.state.doc, 'taskItem')[0].body!;
    const selectionInsideHidden =
      to > body.from && from < body.to;
    expect(selectionInsideHidden).toBe(false);
    expect(from).toBeLessThanOrEqual(inside);
  });
});

describe('task fold chevron in the item view', () => {
  it('renders a chevron only for items with nested content', () => {
    const { editor, dispose } = createEditor();
    cleanup.push(dispose);

    const hosts = editor.view.dom.querySelectorAll(VIEW_TAG);
    // Top-level items: 3 hosts rendered first; the first is foldable.
    const foldable = hosts[0];
    const plain = hosts[1];
    expect(foldable?.querySelector('[data-testid="task-fold-chevron"]')).toBeTruthy();
    expect(plain?.querySelector('[data-testid="task-fold-chevron"]')).toBeNull();
  });

  it('chevron click toggles the fold', () => {
    const { editor, dispose } = createEditor();
    cleanup.push(dispose);

    const host = editor.view.dom.querySelector(VIEW_TAG);
    const chevron = host?.querySelector<HTMLElement>('[data-testid="task-fold-chevron"]');
    expect(chevron).toBeTruthy();

    chevron!.click();
    expect(getFoldedTaskPositions(editor.state).length).toBe(1);
    expect(host?.classList.contains('is-folded')).toBe(true);

    chevron!.click();
    expect(getFoldedTaskPositions(editor.state).length).toBe(0);
    expect(host?.classList.contains('is-folded')).toBe(false);
  });

  it('chevron click does not toggle the checkbox', () => {
    const { editor, dispose } = createEditor();
    cleanup.push(dispose);

    const host = editor.view.dom.querySelector(VIEW_TAG);
    const chevron = host?.querySelector<HTMLElement>('[data-testid="task-fold-chevron"]');
    chevron!.click();
    expect(host?.getAttribute('data-checked')).toBe('false');
  });
});

describe('regressions: fold state survival on edits', () => {
  it('deleting a folded item drops the fold instead of transferring it to the next sibling', () => {
    // Regression: mapping.map(pos, -1) mapped a deleted item's fold onto
    // the position of the NEXT item, and the type check passed — folding
    // "parent two" after "parent one" was deleted.
    const { editor, items, dispose } = createEditor();
    cleanup.push(dispose);

    dispatchFoldMeta(editor, { type: 'fold', pos: items[0] });
    expect(getFoldedTaskPositions(editor.state)).toEqual([items[0]]);

    // Delete the folded "parent one" node.
    const node = editor.state.doc.nodeAt(items[0])!;
    editor.commands.command(({ tr }) => {
      tr.delete(items[0], items[0] + node.nodeSize);
      return true;
    });

    expect(getFoldedTaskPositions(editor.state)).toEqual([]);
  });

  it('Backspace at the start of a folded item drops the fold on join', () => {
    // The realistic user path: caret at the start of the folded item's own
    // text, Backspace — the item joins into the previous sibling and its
    // node identity disappears, so the fold must go with it (not persist on
    // the merged node, whose sublist stays visible).
    const { editor, items, dispose } = createEditor();
    cleanup.push(dispose);

    dispatchFoldMeta(editor, { type: 'fold', pos: items[2] }); // "parent two"
    expect(getFoldedTaskPositions(editor.state)).toEqual([items[2]]);

    // Caret at the start of "parent two"'s text — it joins into "plain".
    editor.commands.setTextSelection(items[2] + 2);
    const event = new KeyboardEvent('keydown', {
      key: 'Backspace',
      bubbles: true,
      cancelable: true,
    });
    let handled = false;
    editor.view.someProp(
      'handleKeyDown',
      (f) => (handled = f(editor.view, event) || handled),
    );
    expect(handled).toBe(true);

    expect(getFoldedTaskPositions(editor.state)).toEqual([]);
    // The joined item keeps the nested list visible (not hidden anywhere).
    const hidden = editor.view.dom.querySelectorAll('.texto-folded-content');
    expect(hidden.length).toBe(0);
  });

  it('Backspace lifting an unrelated item keeps an unrelated later fold intact', () => {
    const { editor, items, dispose } = createEditor();
    cleanup.push(dispose);

    dispatchFoldMeta(editor, { type: 'fold', pos: items[2] }); // "parent two"

    // Caret at the start of "plain"'s (item 1) text — it lifts out of the
    // list; "parent two" (item 2) is untouched and must stay folded.
    editor.commands.setTextSelection(items[1] + 2);
    const event = new KeyboardEvent('keydown', {
      key: 'Backspace',
      bubbles: true,
      cancelable: true,
    });
    editor.view.someProp('handleKeyDown', (f) => f(editor.view, event));

    const folded = getFoldedTaskPositions(editor.state);
    expect(folded).toHaveLength(1);
    const node = editor.state.doc.nodeAt(folded[0]);
    expect(node?.type.name).toBe('taskItem');
    expect(node?.textContent).toBe('parent twochild three');
  });

  it('Enter-splitting a folded item moves the subtasks and drops the now-empty fold', () => {
    // splitListItem carries the nested list to the second item; the first
    // item keeps its own paragraph only. A persisted fold on it would be
    // an invisible no-op that re-collapses content if children are added
    // again later.
    const { editor, items, dispose } = createEditor();
    cleanup.push(dispose);

    dispatchFoldMeta(editor, { type: 'fold', pos: items[0] });

    // Caret at the end of "parent one"'s text, then Enter.
    editor.commands.setTextSelection(items[0] + 2 + 'parent one'.length);
    editor.commands.splitListItem('taskItem');

    const folded = getFoldedTaskPositions(editor.state);
    expect(folded).toEqual([]);

    // The subtasks now live in the new second item, which is not folded.
    const json = editor.getJSON();
    const list = json.content!.find((n) => n.type === 'taskList')!;
    const second = list.content![1];
    expect(second.content!.some((n) => n.type === 'taskList')).toBe(true);
  });

  it('restore ignores positions of items without nested content', () => {
    const { editor, items, dispose } = createEditor();
    cleanup.push(dispose);

    // "plain" has no nested list — restoring a fold onto it must be a no-op.
    editor.view.dispatch(
      editor.state.tr.setMeta(taskFoldingKey, {
        type: 'restore',
        positions: [items[1]],
      }),
    );

    expect(getFoldedTaskPositions(editor.state)).toEqual([]);
  });
});

describe('regressions: caret never left inside a hidden region', () => {
  it('Tab sinking an item under a folded parent pushes the caret out of the hidden body', () => {
    // Regression: sinkListItem moved the selection into the folded
    // parent's hidden body and nothing pushed it back — the user would
    // type into invisible content.
    const content: JSONContent = {
      type: 'noteDoc',
      content: [
        { type: 'noteTitle', content: [] },
        {
          type: 'taskList',
          content: [
            taskItem('parent', [subList(taskItem('child'))]),
            taskItem('sibling'),
          ],
        },
      ],
    };

    const { editor, items, dispose } = createEditor(content);
    cleanup.push(dispose);

    dispatchFoldMeta(editor, { type: 'fold', pos: items[0] });

    // Caret at the end of "sibling"'s text; Tab sinks it under "parent".
    editor.commands.setTextSelection(items[1] + 2 + 'sibling'.length);
    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    let handled = false;
    editor.view.someProp(
      'handleKeyDown',
      (f) => (handled = f(editor.view, event) || handled),
    );
    expect(handled).toBe(true);

    // The sunk item is now inside the parent's (hidden) body — the caret
    // must not be in there with it.
    const { from, to } = editor.state.selection;
    const section = collectTaskSections(editor.state.doc, 'taskItem')
      .find((s) => s.itemPos === getFoldedTaskPositions(editor.state)[0])!;
    const body = section.body!;
    expect(to > body.from && from < body.to).toBe(false);
  });
});

describe('mobile: folding disabled', () => {
  it('renders no chevron and no folding plugin state', () => {
    const el = document.body.appendChild(createDiv());
    const editor = new Editor({
      element: el,
      content: testContent(),
      extensions: getExtensions({}, { isMobileView: true }),
      editable: true,
    });
    cleanup.push(() => {
      editor.destroy();
      el.remove();
    });

    expect(taskFoldingKey.getState(editor.state)).toBeUndefined();

    const hosts = editor.view.dom.querySelectorAll(VIEW_TAG);
    for (const host of Array.from(hosts)) {
      expect(host.querySelector('[data-testid="task-fold-chevron"]')).toBeNull();
    }
  });
});
