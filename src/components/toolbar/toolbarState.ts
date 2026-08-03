import type { Editor } from '../../texto/core';

export interface ToolbarState {
  paragraph: boolean;
  heading1: boolean;
  heading2: boolean;
  heading3: boolean;
  blockquote: boolean;
  taskList: boolean;
  bulletList: boolean;
  orderedList: boolean;
  codeBlock: boolean;
}

/**
 * Returns the highlight state of toolbar buttons based on the current editor selection.
 * Pure function of editor.isActive — easy to test with a mock editor.
 */
export function getToolbarState(editor: Pick<Editor, 'isActive'>): ToolbarState {
  return {
    paragraph: editor.isActive('paragraph'),
    heading1: editor.isActive('heading', { level: 1 }),
    heading2: editor.isActive('heading', { level: 2 }),
    heading3: editor.isActive('heading', { level: 3 }),
    blockquote: editor.isActive('blockquote'),
    taskList: editor.isActive('taskList'),
    bulletList: editor.isActive('bulletList'),
    orderedList: editor.isActive('orderedList'),
    codeBlock: editor.isActive('hljsCodeBlock'),
  };
}