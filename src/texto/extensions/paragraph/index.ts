import type { CommandsSet } from '../../core/@types'
import type { addCommands } from './commands'
import { Paragraph } from './paragraph'

export * from './paragraph'
export default Paragraph

declare global {
  interface Commands extends CommandsSet<ReturnType<typeof addCommands>> {}
}
