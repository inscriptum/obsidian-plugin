import { describe, it, expect, vi } from 'vitest';
import { Editor } from './Editor';
import { getExtensions } from '../getExtensions';
import { createEmptyNote } from '../../storage/noteStorage';

function createEditor(content = createEmptyNote()) {
  return new Editor({
    element: document.createElement('div'),
    content,
    extensions: getExtensions(),
  });
}

describe('editor lifecycle', () => {
  it('creates editor and parses initial content', () => {
    const editor = createEditor();

    expect(editor.schema).toBeDefined();
    expect(editor.getJSON().type).toBe('noteDoc');

    editor.destroy();
  });

  it('emits update event on content change', () => {
    const onUpdate = vi.fn();

    const editor = new Editor({
      element: document.createElement('div'),
      content: createEmptyNote(),
      extensions: getExtensions(),
      onUpdate,
    });

    editor.commands.setContent(
      {
        type: 'noteDoc',
        content: [
          { type: 'noteTitle', content: [] },
          { type: 'paragraph', content: [{ type: 'text', text: 'changed' }] },
        ],
      },
      true,
    );

    expect(onUpdate).toHaveBeenCalled();

    editor.destroy();
  });

  it('handles empty content without errors', () => {
    const editor = createEditor();

    expect(editor.isEmpty).toBe(true);

    editor.destroy();
  });
});