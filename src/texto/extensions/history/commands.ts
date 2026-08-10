import type { Command } from '../../core/@types'
import type { AnyConfig } from '../../core/@types/AnyConfig'
import { redo, undo } from 'prosemirror-history'

type AddCommandsThis = ThisParameterType<Required<AnyConfig>['addCommands']>

export function addCommands(this: AddCommandsThis) {
  return {
    undo:
      (): Command =>
      ({ state, dispatch }) => {
        return undo(state, dispatch)
      },
    redo:
      (): Command =>
      ({ state, dispatch }) => {
        return redo(state, dispatch)
      },
  }
}
