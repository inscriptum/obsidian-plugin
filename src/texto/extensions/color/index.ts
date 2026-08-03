import type { CommandsSet } from '../../core/@types'
import type { addCommands } from './commands'
import { Color } from './color'

export * from './color'
export default Color

declare global {
  interface Commands extends CommandsSet<ReturnType<typeof addCommands>> {}
}
