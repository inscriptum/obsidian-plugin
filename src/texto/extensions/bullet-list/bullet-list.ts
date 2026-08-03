import { mergeAttributes, Node, wrappingInputRule } from '../../core'
import { addCommands } from './commands'

export interface BulletListOptions {
  HTMLAttributes: Record<string, any>
}

export const inputRegex = /^\s*([-+*])\s$/

export const BulletList = Node.create<BulletListOptions>({
  name: 'bulletList',

  addOptions() {
    return {
      HTMLAttributes: {},
    }
  },

  group: 'block list',

  content: 'listItem+',

  parseHTML() {
    return [
      { tag: 'ul' },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['ul', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0]
  },

  addCommands,

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-8': () => (this.editor.commands as any).toggleBulletList(),
    }
  },

  addInputRules() {
    return [
      wrappingInputRule({
        find: inputRegex,
        type: this.type,
      }),
    ]
  },
})
