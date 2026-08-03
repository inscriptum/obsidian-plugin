import type { CommandsSet } from '../../core/@types'
import type { addCommands } from './commands'
import { Strike } from './strike'

export * from './strike'
export default Strike

declare global {
  interface Commands extends CommandsSet<ReturnType<typeof addCommands>> {}
}
