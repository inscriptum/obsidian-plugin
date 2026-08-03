export function addCommands() {
  return {
    setBold: () => ({ commands }: { commands: any }) => {
      return commands.setMark('bold')
    },
    toggleBold: () => ({ commands }: { commands: any }) => {
      return commands.toggleMark('bold')
    },
    unsetBold: () => ({ commands }: { commands: any }) => {
      return commands.unsetMark('bold')
    },
  }
}
