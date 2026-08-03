import type { CommandsSet } from '../../core/@types'
import type { addCommands } from './commands'
import { Bold } from './bold'

export * from './bold'
export default Bold

declare global {
  interface Commands extends CommandsSet<ReturnType<typeof addCommands>> {}
}
