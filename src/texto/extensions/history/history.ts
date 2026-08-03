import { Extension } from '../../core'
import { history, redo, undo } from 'prosemirror-history'

export interface HistoryOptions {
  depth: number
  newGroupDelay: number
}

export const History = Extension.create<HistoryOptions>({
  name: 'history',

  addOptions() {
    return {
      depth: 100,
      newGroupDelay: 500,
    }
  },

  addCommands() {
    return {
      undo: () => ({ state, dispatch }) => {
        return undo(state, dispatch)
      },
      redo: () => ({ state, dispatch }) => {
        return redo(state, dispatch)
      },
    }
  },

  addProseMirrorPlugins() {
    return [
      history(this.options),
    ]
  },

  addKeyboardShortcuts() {
    return {
      'Mod-z': () => (this.editor.commands as any).undo(),
      'Shift-Mod-z': () => (this.editor.commands as any).redo(),
      'Mod-y': () => (this.editor.commands as any).redo(),
    }
  },
})
