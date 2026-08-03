import { mergeAttributes, Node, nodeInputRule } from '../../core'

export interface HorizontalRuleOptions {
  HTMLAttributes: Record<string, any>
}

export const HorizontalRule = Node.create<HorizontalRuleOptions>({
  name: 'horizontalRule',

  addOptions() {
    return {
      HTMLAttributes: {},
    }
  },

  group: 'block',

  parseHTML() {
    return [{ tag: 'hr' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['hr', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)]
  },

  addCommands() {
    return {
      setHorizontalRule:
        () => ({ chain }) => {
          return chain()
            .insertContent({ type: this.name })
            .run()
        },
    }
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Alt--': () => (this.editor.commands as any).setHorizontalRule(),
    }
  },

  addInputRules() {
    return [
      nodeInputRule({
        find: /^(?:---|—-|___\s|\*\*\*\s)$/,
        type: this.type,
      }),
    ]
  },
})
