import type { CommandsSet } from '../../core/@types'
import type { addCommands } from './commands'
import { TextStyle } from './text-style'

export * from './text-style'
export default TextStyle

declare global {
  interface Commands extends CommandsSet<ReturnType<typeof addCommands>> {}
}
