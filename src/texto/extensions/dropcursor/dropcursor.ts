import { Extension } from '../../core';
import { dropCursor } from 'prosemirror-dropcursor';

export interface DropcursorOptions {
  /** CSS color of the cursor, or `false` to style only via class. */
  color: string | false;
  /** Cursor width in pixels. */
  width: number;
  /** Extra CSS class on the cursor element. */
  class?: string;
}

export const Dropcursor = Extension.create<DropcursorOptions>({
  name: 'dropCursor',

  addOptions() {
    return {
      // Styled via CSS (see styles/drag-handle.css) so themes can adjust it;
      // `false` keeps the plugin from writing an inline border color.
      color: false,
      width: 2,
      class: 'texto-drop-cursor',
    };
  },

  addProseMirrorPlugins() {
    return [
      dropCursor(this.options),
    ];
  },
});
