import type { CommandsSet } from '../../core/@types'
import type { addCommands } from './commands'
import { HardBreak } from './hard-break'

export * from './hard-break'
export default HardBreak

declare global {
  interface Commands extends CommandsSet<ReturnType<typeof addCommands>> {}
}
