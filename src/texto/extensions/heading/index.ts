import type { CommandsSet } from '../../core/@types'
import type { addCommands } from './commands'
import type { addCommands as addFoldingCommands } from './foldingCommands'
import { Heading } from './heading'

export * from './heading'
export * from './folding'
export default Heading

declare global {
  interface Commands
    extends CommandsSet<ReturnType<typeof addCommands>>,
      CommandsSet<ReturnType<typeof addFoldingCommands>> {}
}
