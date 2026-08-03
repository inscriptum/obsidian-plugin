export function addCommands() {
  return {
    setParagraph: () => ({ commands }: { commands: any }) => {
      return commands.setNode('paragraph')
    },
  }
}
