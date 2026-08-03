export function addCommands() {
  return {
    setHeading: (attributes: { level: number }) => ({ commands }: { commands: any }) => {
      return commands.setNode('heading', attributes)
    },
    toggleHeading: (attributes: { level: number }) => ({ commands }: { commands: any }) => {
      return commands.toggleNode('heading', 'paragraph', attributes)
    },
  }
}
