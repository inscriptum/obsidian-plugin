export function addCommands() {
  return {
    setBlockquote: () => ({ commands }: { commands: any }) => {
      return commands.wrapIn('blockquote')
    },
    toggleBlockquote: () => ({ commands }: { commands: any }) => {
      return commands.toggleWrap('blockquote')
    },
    unsetBlockquote: () => ({ commands }: { commands: any }) => {
      return commands.lift('blockquote')
    },
  }
}
