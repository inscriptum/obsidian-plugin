import type { CommandsSet } from '../../core/@types'
import type { addCommands } from './commands'
import { Italic } from './italic'

export * from './italic'
export default Italic

declare global {
  interface Commands extends CommandsSet<ReturnType<typeof addCommands>> {}
}
