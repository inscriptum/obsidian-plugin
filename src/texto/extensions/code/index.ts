import type { CommandsSet } from '../../core/@types'
import type { addCommands } from './commands'
import { Code } from './code'

export * from './code'
export default Code

declare global {
  interface Commands extends CommandsSet<ReturnType<typeof addCommands>> {}
}
