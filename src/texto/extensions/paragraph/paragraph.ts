import { mergeAttributes, Node } from '../../core'
import type { AnyRecord } from '../../core/@types'
import { addCommands } from './commands'

export interface ParagraphOptions {
  HTMLAttributes: AnyRecord
}

declare module '../../core' {
  interface Commands<ReturnType> {
    paragraph: {
      setParagraph: () => ReturnType
    }
  }
}

export const Paragraph = Node.create<ParagraphOptions>({
  name: 'paragraph',

  priority: 1000,

  addOptions() {
    return {
      HTMLAttributes: {},
    }
  },

  group: 'block',

  content: 'inline*',

  parseHTML() {
    return [
      { tag: 'p' },
    ]
  },

  renderHTML({ HTMLAttributes }) {
    return ['p', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0]
  },

  addCommands,

  addKeyboardShortcuts() {
    return {
      'Mod-Alt-0': () => this.editor.commands.setParagraph(),
    }
  },
})
