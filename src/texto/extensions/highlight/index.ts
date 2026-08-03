import type { CommandsSet } from '../../core/@types'
import type { addCommands } from './commands'
import { Highlight } from './highlight'

export * from './highlight'
export default Highlight

declare global {
  interface Commands extends CommandsSet<ReturnType<typeof addCommands>> {}
}
