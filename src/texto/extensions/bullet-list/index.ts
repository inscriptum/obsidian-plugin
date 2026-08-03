import { CommandsSet } from '../../core/@types'

import { addCommands } from './commands'
import { BulletList } from './bullet-list'

export * from './bullet-list'
export default BulletList

declare global {
  interface Commands extends CommandsSet<ReturnType<typeof addCommands>> {}
}
