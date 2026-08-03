export function addCommands() {
  return {
    setUnderline: () => ({ commands }: { commands: any }) => {
      return commands.setMark('underline')
    },
    toggleUnderline: () => ({ commands }: { commands: any }) => {
      return commands.toggleMark('underline')
    },
    unsetUnderline: () => ({ commands }: { commands: any }) => {
      return commands.unsetMark('underline')
    },
  }
}
