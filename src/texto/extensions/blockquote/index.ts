import type { CommandsSet } from '../../core/@types'
import type { addCommands } from './commands'
import { Blockquote } from './blockquote'

export * from './blockquote'
export default Blockquote

declare global {
  interface Commands extends CommandsSet<ReturnType<typeof addCommands>> {}
}
