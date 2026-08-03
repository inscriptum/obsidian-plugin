export function addCommands() {
  return {
    removeEmptyTextStyle: () => ({ state, commands }: { state: any; commands: any }) => {
      return true
    },
  }
}
