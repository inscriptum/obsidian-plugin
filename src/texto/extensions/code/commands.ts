export function addCommands() {
  return {
    setCode: () => ({ commands }: { commands: any }) => {
      return commands.setMark('code')
    },
    toggleCode: () => ({ commands }: { commands: any }) => {
      return commands.toggleMark('code')
    },
    unsetCode: () => ({ commands }: { commands: any }) => {
      return commands.unsetMark('code')
    },
  }
}
