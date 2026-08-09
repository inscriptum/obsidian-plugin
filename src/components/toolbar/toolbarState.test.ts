import { describe, it, expect } from 'vitest';
import type { Editor } from '../../texto/core';
import { getToolbarState } from './toolbarState';

function makeEditor(active: Record<string, boolean>): Pick<Editor, 'isActive'> {
  return {
    isActive(name: string, attrs?: {level?: number}) {
      if (name === 'heading') return active[`heading${attrs?.level}`] ?? false;
      return active[name] ?? false;
    },
  };
}

describe('getToolbarState', () => {
  it('all false by default', () => {
    expect(getToolbarState(makeEditor({}))).toEqual({
      paragraph: false,
      heading1: false,
      heading2: false,
      heading3: false,
      blockquote: false,
      taskList: false,
      bulletList: false,
      orderedList: false,
      codeBlock: false,
    });
  });

  it('detects paragraph', () => {
    expect(getToolbarState(makeEditor({ paragraph: true })).paragraph).toBe(true);
  });

  it('detects heading levels separately', () => {
    expect(getToolbarState(makeEditor({ heading1: true })).heading1).toBe(true);
    expect(getToolbarState(makeEditor({ heading1: true })).heading2).toBe(false);
    expect(getToolbarState(makeEditor({ heading2: true })).heading2).toBe(true);
    expect(getToolbarState(makeEditor({ heading3: true })).heading3).toBe(true);
    expect(getToolbarState(makeEditor({ heading3: true })).heading2).toBe(false);
  });

  it('detects blockquote', () => {
    expect(getToolbarState(makeEditor({ blockquote: true })).blockquote).toBe(true);
  });

  it('detects lists and code block', () => {
    const s = getToolbarState(
      makeEditor({ taskList: true, bulletList: false, orderedList: true, hljsCodeBlock: true }),
    );
    expect(s.taskList).toBe(true);
    expect(s.bulletList).toBe(false);
    expect(s.orderedList).toBe(true);
    expect(s.codeBlock).toBe(true);
  });
});