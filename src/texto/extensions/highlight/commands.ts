export function addCommands() {
  return {
    setHighlight: (attributes?: { color: string }) => ({ commands }: { commands: any }) => {
      return commands.setMark('highlight', attributes)
    },
    toggleHighlight: (attributes?: { color: string }) => ({ commands }: { commands: any }) => {
      return commands.toggleMark('highlight', attributes)
    },
    unsetHighlight: () => ({ commands }: { commands: any }) => {
      return commands.unsetMark('highlight')
    },
  }
}
