import { mergeAttributes, Node, textblockTypeInputRule } from '../../core'
import type { AnyRecord } from '../../core/@types'
import { addCommands } from './commands'

export type Level = 1 | 2 | 3 | 4 | 5 | 6

interface HeadingAttrs {
  level: Level
}

export interface HeadingOptions {
  levels: Level[]
  HTMLAttributes: AnyRecord
}

declare module '../../core' {
  interface Commands<ReturnType> {
    heading: {
      setHeading: (attributes: { level: Level }) => ReturnType
      toggleHeading: (attributes: { level: Level }) => ReturnType
    }
  }
}

export const Heading = Node.create<HeadingOptions>({
  name: 'heading',

  addOptions() {
    return {
      levels: [1, 2, 3, 4, 5, 6],
      HTMLAttributes: {},
    }
  },

  content: 'inline*',

  group: 'block',

  defining: true,

  addAttributes() {
    return {
      level: {
        default: 1,
        rendered: false,
      },
    }
  },

  parseHTML() {
    return this.options.levels
      .map((level: Level) => ({
        tag: `h${level}`,
        attrs: { level },
      }))
  },

  renderHTML({ node, HTMLAttributes }) {
    const attrs = node.attrs as HeadingAttrs
    const hasLevel = this.options.levels.includes(attrs.level)
    const level = hasLevel
      ? attrs.level
      : this.options.levels[0]

    return [`h${level}`, mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0]
  },

  addCommands,

  addKeyboardShortcuts() {
    return this.options.levels.reduce((items, level) => ({
      ...items,
      ...{
        [`Mod-Alt-${level}`]: () => this.editor.commands.toggleHeading({ level }),
      },
    }), {})
  },

  addInputRules() {
    return this.options.levels.map(level => {
      return textblockTypeInputRule({
        find: new RegExp(`^(#{1,${level}})\\s$`),
        type: this.type,
        getAttributes: {
          level,
        },
      })
    })
  },
})
