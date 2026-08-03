export function addCommands() {
  return {
    setStrike: () => ({ commands }: { commands: any }) => {
      return commands.setMark('strike')
    },
    toggleStrike: () => ({ commands }: { commands: any }) => {
      return commands.toggleMark('strike')
    },
    unsetStrike: () => ({ commands }: { commands: any }) => {
      return commands.unsetMark('strike')
    },
  }
}
