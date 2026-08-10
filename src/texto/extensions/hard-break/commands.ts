import type { Command } from '../../core/@types'
import type { AnyConfig } from '../../core/@types/AnyConfig'

type AddCommandsThis = ThisParameterType<Required<AnyConfig>['addCommands']>

export function addCommands(this: AddCommandsThis) {
  return {
    setHardBreak:
      (): Command =>
      ({ commands, chain, state, editor }) => {
        return commands.first([
          () => commands.exitCode(),
          () => commands.command(() => {
            const { selection, storedMarks } = state

            if (selection.$from.parent.type.spec.isolating) {
              return false
            }

            const { keepMarks } = this.options
            const { splittableMarks } = editor.extensionManager
            const marks = storedMarks
              || (selection.$to.parentOffset && selection.$from.marks())

            return chain()
              .insertContent({ type: this.name })
              .command(({ tr, dispatch }) => {
                if (dispatch && marks && keepMarks) {
                  const filteredMarks = marks
                    .filter(mark => splittableMarks.includes(mark.type.name))

                  tr.ensureMarks(filteredMarks)
                }

                return true
              })
              .run()
          }),
        ])
      },
  }
}
