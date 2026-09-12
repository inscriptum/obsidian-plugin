import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '../../core/Editor';
import type { JSONContent } from '../../core/@types';
import { getExtensions } from '../../getExtensions';
import { NodeSelection } from 'prosemirror-state';
import {
  findDraggableBlock,
  performBlockMove,
  startDragWithBlock,
  dragHandleKey,
  DRAG_HANDLE_CSS,
} from './dragHandlePlugin';

/**
 * Test document:
 *
 *   noteTitle     "Title"
 *   p             "Intro"
 *   bulletList    (li > p "Item one")   <- items drag individually
 *   blockquote    (p "Quoted")
 *   taskList      (taskItem > p "Todo one")
 */
function testContent(): JSONContent {
  return {
    type: 'noteDoc',
    content: [
      { type: 'noteTitle', content: [{ type: 'text', text: 'Title' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Intro' }] },
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'Item one' }] },
            ],
          },
          {
            type: 'listItem',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'Item two' }] },
            ],
          },
        ],
      },
      {
        type: 'blockquote',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'Quoted' }] },
        ],
      },
      {
        type: 'taskList',
        content: [
          {
            type: 'taskItem',
            attrs: { checked: false },
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'Todo one' }] },
            ],
          },
          {
            type: 'taskItem',
            attrs: { checked: false },
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'Todo two' }] },
            ],
          },
        ],
      },
    ],
  };
}

interface Fixture {
  editor: Editor;
  /** Positions of the top-level blocks, in doc order (title included). */
  positions: number[];
}

function createFixture(
  content: JSONContent = testContent(),
  options: { isMobileView?: boolean } = {},
): Fixture {
  const el = createDiv();
  document.body.appendChild(el);

  const editor = new Editor({
    element: el,
    content,
    extensions: getExtensions({}, options),
    editable: true,
  });

  const positions: number[] = [];
  editor.state.doc.forEach((_, pos) => {
    positions.push(pos);
  });

  return { editor, positions };
}

const fixtures: Fixture[] = [];

function useFixture(
  content?: JSONContent,
  options?: { isMobileView?: boolean },
): Fixture {
  const fixture = createFixture(content, options);
  fixtures.push(fixture);
  return fixture;
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    fixture.editor.destroy();
    fixture.editor.options.element.remove();
  }
});

describe('findDraggableBlock', () => {
  it('resolves a position inside a paragraph to the whole block', () => {
    const { editor, positions } = useFixture();
    const doc = editor.state.doc;
    // "Intro" paragraph: pos + 1 is inside its inline content.
    const block = findDraggableBlock(doc, positions[1] + 1);

    expect(block).not.toBeNull();
    expect(block?.node.type.name).toBe('paragraph');
    expect(block?.node.textContent).toBe('Intro');
    expect(block?.from).toBe(positions[1]);
    expect(block?.to).toBe(positions[1] + doc.nodeAt(positions[1])!.nodeSize);
  });

  it('resolves list content to the individual item, other nesting to the whole block', () => {
    const { editor, positions } = useFixture();
    const doc = editor.state.doc;

    // Inside a list item paragraph -> the item itself, not the whole list.
    const item = findDraggableBlock(doc, positions[2] + 3);
    expect(item?.node.type.name).toBe('listItem');
    expect(item?.node.textContent).toBe('Item one');

    // Inside a blockquote -> the whole top-level blockquote.
    const quote = findDraggableBlock(doc, positions[3] + 2);
    expect(quote?.node.type.name).toBe('blockquote');
  });

  it('resolves a border position between blocks to the following block', () => {
    const { editor, positions } = useFixture();
    const doc = editor.state.doc;

    const block = findDraggableBlock(doc, positions[2]);
    expect(block?.node.type.name).toBe('bulletList');
    expect(block?.from).toBe(positions[2]);
  });

  it('resolves doc end to the last block', () => {
    const { editor } = useFixture();
    const doc = editor.state.doc;

    // Doc end border: no nodeAfter -> the previous block (taskList start).
    const block = findDraggableBlock(doc, doc.content.size);
    expect(block?.node.type.name).toBe('taskList');
  });

  it('resolves a task item position to the individual taskItem', () => {
    const { editor } = useFixture();
    const doc = editor.state.doc;

    const listPos = doc.content.content
      .slice(0, 4)
      .reduce((s, n) => s + n.nodeSize, 0);
    // Inside the task item's paragraph.
    const block = findDraggableBlock(doc, listPos + 2);
    expect(block?.node.type.name).toBe('taskItem');
    expect(block?.node.textContent).toBe('Todo one');
  });

  it('returns null for the document title and out-of-range positions', () => {
    const { editor, positions } = useFixture();
    const doc = editor.state.doc;

    expect(findDraggableBlock(doc, positions[0] + 1)).toBeNull();

    expect(findDraggableBlock(doc, -1)).toBeNull();
    expect(findDraggableBlock(doc, doc.content.size + 1)).toBeNull();
  });
});

describe('pointer drag flow', () => {
  it('startDragWithBlock selects the unit and activates the drag state', () => {
    const { editor, positions } = useFixture();
    const view = editor.view;
    const doc = editor.state.doc;

    const block = findDraggableBlock(doc, positions[1] + 1, undefined, editor.state)!;
    const started = startDragWithBlock(view, block);

    expect(started).toBe(true);
    // The dragged unit is selected (visible feedback like PM's move-drag).
    expect(view.state.selection instanceof NodeSelection).toBe(true);
    expect(view.state.selection.from).toBe(positions[1]);
    // Plugin state: drag active with the source insert position.
    const pluginState = dragHandleKey.getState(view.state) as { drag: unknown } | undefined;
    expect(pluginState?.drag).not.toBeNull();
    // Dragging is a selection change, not a document edit.
    expect(editor.state.doc.eq(doc)).toBe(true);
  });

  it('refuses to drag the document title', () => {
    const { editor, positions } = useFixture();
    const view = editor.view;
    const doc = editor.state.doc;

    const block = findDraggableBlock(doc, positions[0] + 1);
    expect(block).toBeNull();
    expect(view.state.selection instanceof NodeSelection).toBe(false);
  });

  it('performBlockMove moves the block and selects the moved node', () => {
    const { editor, positions } = useFixture();
    const view = editor.view;
    const doc = editor.state.doc;

    // Drag the 'Intro' paragraph (block index 1) to the start of the
    // blockquote: after deleting the source, the insert position maps to
    // just before the blockquote.
    const block = findDraggableBlock(doc, positions[1] + 1)!;
    const moved = performBlockMove(view, block, positions[3]);

    expect(moved).toBe(true);
    const after = view.state.doc;
    // New order: title, bulletList, 'Intro', blockquote, taskList.
    const texts = after.content.content.map((n) => n.textContent);
    expect(texts[0]).toBe('Title');
    expect(texts[1]).toBe('Item oneItem two');
    expect(texts[2]).toBe('Intro');
    expect(texts[3]).toBe('Quoted');
    // Selection points into the moved node.
    expect(view.state.selection instanceof NodeSelection).toBe(true);
    expect(after.nodeAt(view.state.selection.from)?.textContent).toBe('Intro');
  });

  it('performBlockMove reorders list items individually', () => {
    const { editor, positions } = useFixture();
    const view = editor.view;
    const doc = editor.state.doc;

    // The second list item ('Item two').
    const listPos = positions[2];
    const firstItem = doc.nodeAt(listPos + 1)!;
    const secondItemFrom = listPos + 1 + firstItem.nodeSize;
    const block = findDraggableBlock(doc, secondItemFrom + 3)!;
    expect(block.node.textContent).toBe('Item two');

    // Move it before the first item: insert at the first item's position.
    const moved = performBlockMove(view, block, listPos + 1);

    expect(moved).toBe(true);
    const list = view.state.doc.content.content.find(
      (n) => n.type.name === 'bulletList',
    )!;
    expect(list.textContent).toBe('Item twoItem one');
    // No empty lists remain: both items are in one list.
    expect(list.content.content.length).toBe(2);
  });

  it('moving the last item out removes the emptied source list', () => {
    const content = testContent();
    // Keep only ONE item in the bulletList.
    const list = content.content![2];
    list.content = [list.content![0]];
    const { editor, positions } = useFixture(content);
    const view = editor.view;
    const doc = editor.state.doc;

    const block = findDraggableBlock(doc, positions[2] + 3)!; // 'Item one'
    // Move onto the doc level, before the blockquote: dropPoint wraps the
    // item into a new list; the emptied source list must disappear.
    const moved = performBlockMove(view, block, positions[3]);

    expect(moved).toBe(true);
    const types = view.state.doc.content.content.map((n) => n.type.name);
    expect(types.filter((t) => t === 'bulletList').length).toBe(1);
    expect(view.state.doc.content.content[2].type.name).toBe('bulletList');
    expect(view.state.doc.content.content[2].textContent).toBe('Item one');
  });
});

describe('DragHandle extension', () => {
  it('creates the handle DOM in the editor container (desktop)', () => {
    const { editor } = useFixture();
    const container = editor.view.dom.parentElement!;

    const handle = container.querySelector(`.${DRAG_HANDLE_CSS.handle}`);
    expect(handle).not.toBeNull();
    // Pointer-driven drag: the handle is not a native draggable anymore.
    expect(handle!.getAttribute('draggable')).toBeNull();
    expect(dragHandleKey.get(editor.state)).not.toBeUndefined();
  });

  it('is disabled on mobile', () => {
    const { editor } = useFixture(undefined, { isMobileView: true });

    // spec.key holds the PluginKey object itself when a plugin is created
    // with an explicit key — compare by identity.
    expect(
      editor.state.plugins.some((p) => p.spec.key === dragHandleKey),
    ).toBe(false);
  });

  it('keeps the dropcursor plugin always available', () => {
    const { editor } = useFixture(undefined, { isMobileView: true });

    // prosemirror-dropcursor creates its Plugin without a readable key,
    // so assert via the registered extension instead.
    expect(
      editor.extensionManager.extensions.some((e) => e.name === 'dropCursor'),
    ).toBe(true);
  });
});
