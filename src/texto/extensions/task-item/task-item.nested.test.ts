import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '../../core/Editor';
import { getExtensions } from '../../getExtensions';
import type { JSONContent } from '../../core/@types';
import { VIEW_TAG } from './task-item';

function createEditor(content?: JSONContent, element?: HTMLElement) {
  return new Editor({
    element: element ?? createDiv(),
    content: content ?? { type: 'noteDoc', content: [] },
    extensions: getExtensions(),
  });
}

function taskListWithItems(...texts: string[]): JSONContent {
  return {
    type: 'noteDoc',
    content: [
      { type: 'noteTitle', content: [] },
      {
        type: 'taskList',
        content: texts.map((text) => ({
          type: 'taskItem',
          attrs: { checked: false },
          content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
        })),
      },
    ],
  };
}

/** Fires a keydown event through the editor's keymap (ProseMirror handleKeyDown prop). */
function pressKey(editor: Editor, key: string, shift = false) {
  const event = new KeyboardEvent('keydown', { key, shiftKey: shift, bubbles: true, cancelable: true });
  let handled = false;
  editor.view.someProp('handleKeyDown', (f) => {
    handled = f(editor.view, event) || handled;
  });
  return handled;
}

function getFirstTaskList(editor: Editor): JSONContent | undefined {
  return editor.getJSON().content?.find((n) => n.type === 'taskList');
}

const cleanup: Array<() => void> = [];
afterEach(() => {
  while (cleanup.length) cleanup.pop()?.();
});

describe('nested taskList (subtasks)', () => {
  it('schema accepts a nested taskList inside a taskItem and round-trips through JSON', () => {
    const editor = createEditor({
      type: 'noteDoc',
      content: [
        { type: 'noteTitle', content: [] },
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: false },
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'parent' }] },
                {
                  type: 'taskList',
                  content: [
                    {
                      type: 'taskItem',
                      attrs: { checked: false },
                      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'child' }] }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    cleanup.push(() => editor.destroy());

    const taskList = getFirstTaskList(editor);
    expect(taskList).toBeDefined();
    const item = taskList?.content?.[0];
    expect(item?.content?.[1]?.type).toBe('taskList');
    expect(item?.content?.[1]?.content?.[0]?.content?.[0]?.content?.[0]?.text).toBe('child');
  });

  it('Tab turns the next item into a subtask of the previous one', () => {
    const editor = createEditor(taskListWithItems('one', 'two'));
    cleanup.push(() => editor.destroy());

    // place the cursor at the end of the second item
    const docSize = editor.state.doc.content.size;
    editor.commands.setTextSelection({ from: docSize - 2, to: docSize - 2 });

    const handled = pressKey(editor, 'Tab');
    expect(handled).toBe(true);

    const taskList = getFirstTaskList(editor);
    expect(taskList?.content?.length).toBe(1);
    const parent = taskList?.content?.[0];
    expect(parent?.content?.[0]?.content?.[0]?.text).toBe('one');
    const nested = parent?.content?.find((n) => n.type === 'taskList');
    expect(nested?.content?.[0]?.content?.[0]?.content?.[0]?.text).toBe('two');
  });

  it('Shift-Tab lifts a subtask back to the top level', () => {
    const editor = createEditor({
      type: 'noteDoc',
      content: [
        { type: 'noteTitle', content: [] },
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: false },
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'one' }] },
                {
                  type: 'taskList',
                  content: [
                    {
                      type: 'taskItem',
                      attrs: { checked: false },
                      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
    cleanup.push(() => editor.destroy());

    const docSize = editor.state.doc.content.size;
    editor.commands.setTextSelection({ from: docSize - 2, to: docSize - 2 });

    const handled = pressKey(editor, 'Tab', true);
    expect(handled).toBe(true);

    const taskList = getFirstTaskList(editor);
    expect(taskList?.content?.length).toBe(2);
    expect(taskList?.content?.[1]?.content?.[0]?.content?.[0]?.text).toBe('two');
    expect(taskList?.content?.[0]?.content?.find((n) => n.type === 'taskList')).toBeUndefined();
  });

  it('renders a nested taskList inside the parent item view', async () => {
    const el = document.body.appendChild(createDiv());
    cleanup.push(() => el.remove());
    const editor = createEditor({
      type: 'noteDoc',
      content: [
        { type: 'noteTitle', content: [] },
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: false },
              content: [
                { type: 'paragraph', content: [{ type: 'text', text: 'parent' }] },
                {
                  type: 'taskList',
                  content: [
                    {
                      type: 'taskItem',
                      attrs: { checked: false },
                      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'child' }] }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }, el);
    cleanup.push(() => editor.destroy());

    // The item view renders as light DOM inside the custom element;
    // the editor element must be attached for the view to render,
    // and the litView render settles on a microtask.
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    const host = editor.view.dom.querySelector(VIEW_TAG);
    expect(host).toBeTruthy();
    const nestedList = host?.querySelector('ul[data-type="taskList"]');
    expect(nestedList).toBeTruthy();
    expect(nestedList?.textContent).toContain('child');
  });
});
