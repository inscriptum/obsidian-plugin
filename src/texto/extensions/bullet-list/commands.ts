import { Command } from '../../core/@types'
import { AnyConfig } from '../../core/@types/AnyConfig'

type AddCommandsThis = ThisParameterType<Required<AnyConfig>['addCommands']>

function toggleBulletListOverride(this: AddCommandsThis): Command {
  return ({ commands }) => {
    return commands.toggleList(this.name, 'listItem')
  }
}

export function addCommands(this: AddCommandsThis) {
  return {
    toggleBulletList: toggleBulletListOverride.bind(this),
  }
}