import type { CommandsSet } from '../../core/@types'
import type { addCommands } from './commands'
import { History } from './history'

export * from './history'
export default History

declare global {
  interface Commands extends CommandsSet<ReturnType<typeof addCommands>> {}
}
