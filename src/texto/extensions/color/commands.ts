export function addCommands() {
  return {
    setColor: (color: string) => ({ chain }: { chain: any }) => {
      return chain()
        .setMark('textStyle', { color })
        .run()
    },
    unsetColor: () => ({ chain }: { chain: any }) => {
      return chain()
        .setMark('textStyle', { color: null })
        .removeEmptyTextStyle()
        .run()
    },
  }
}
