import { Extension } from '../../core';
import { createDragHandlePlugin, DRAG_HANDLE_EXCLUDED_TYPES } from './dragHandlePlugin';

export interface DragHandleOptions {
  /** Disable entirely (mobile first iteration). */
  enabled: boolean;
}

export const DragHandle = Extension.create<DragHandleOptions>({
  name: 'dragHandle',

  addOptions() {
    return {
      enabled: true,
    };
  },

  addProseMirrorPlugins() {
    if (!this.options.enabled) {
      return [];
    }

    return [
      createDragHandlePlugin({ excludedTypes: DRAG_HANDLE_EXCLUDED_TYPES }),
    ];
  },
});
