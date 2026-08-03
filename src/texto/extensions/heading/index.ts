import type { CommandsSet } from '../../core/@types'
import type { addCommands } from './commands'
import { Heading } from './heading'

export * from './heading'
export default Heading

declare global {
  interface Commands extends CommandsSet<ReturnType<typeof addCommands>> {}
}
