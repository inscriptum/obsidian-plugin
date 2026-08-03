export function addCommands() {
  return {
    setItalic: () => ({ commands }: { commands: any }) => {
      return commands.setMark('italic')
    },
    toggleItalic: () => ({ commands }: { commands: any }) => {
      return commands.toggleMark('italic')
    },
    unsetItalic: () => ({ commands }: { commands: any }) => {
      return commands.unsetMark('italic')
    },
  }
}
