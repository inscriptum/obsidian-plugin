import { describe, it, expect } from 'vitest';
import { Editor } from '../../core/Editor';
import { getExtensions } from '../../getExtensions';

function contentWithTaskItem(checked: boolean) {
  return {
    type: 'noteDoc',
    content: [
      { type: 'noteTitle', content: [] },
      {
        type: 'taskList',
        content: [
          {
            type: 'taskItem',
            attrs: { checked },
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'hello' }] }],
          },
        ],
      },
    ],
  };
}

function renderTaskItem(checked: boolean) {
  const el = createDiv();
  document.body.appendChild(el);

  const editor = new Editor({
    element: el,
    content: contentWithTaskItem(checked),
    extensions: getExtensions(),
    editable: true,
  });

  const item = el.querySelector('texto-extension-task-item');

  return {
    item,
    destroy: () => {
      editor.destroy();
      el.remove();
    },
  };
}

// Regression test for the checkbox not matching the design
// getExtensions() must configure TaskItem with checkboxIconLinks so the
// custom SVG icons (declared in note.element.tsx) are used instead of the
// unstyled native input[type=checkbox].
describe('taskItem checkbox rendering', () => {
  it('renders the custom "off" svg icon and hides the native checkbox when unchecked', () => {
    const { item, destroy } = renderTaskItem(false);

    expect(item).toBeTruthy();
    expect(item?.getAttribute('data-checked')).toBe('false');

    const use = item?.querySelector('.custom-icon use');
    expect(use?.getAttribute('href')).toBe('#check_box_off_20');

    const input = item?.querySelector('input[type="checkbox"]');
    expect(input?.classList.contains('visually-hidden')).toBe(true);

    destroy();
  });

  it('renders the custom "on" svg icon when checked', () => {
    const { item, destroy } = renderTaskItem(true);

    expect(item?.getAttribute('data-checked')).toBe('true');

    const use = item?.querySelector('.custom-icon use');
    expect(use?.getAttribute('href')).toBe('#check_box_on_20');

    destroy();
  });
});
