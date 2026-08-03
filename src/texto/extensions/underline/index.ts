import type { CommandsSet } from '../../core/@types'
import type { addCommands } from './commands'
import { Underline } from './underline'

export * from './underline'
export default Underline

declare global {
  interface Commands extends CommandsSet<ReturnType<typeof addCommands>> {}
}
