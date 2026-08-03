import { CommandsSet } from '../../core/@types'

import { addCommands } from './commands'
import { OrderedList } from './ordered-list'

export * from './ordered-list'
export default OrderedList

declare global {
  interface Commands extends CommandsSet<ReturnType<typeof addCommands>> {}
}
