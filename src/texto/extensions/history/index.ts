import { History } from './history'

export * from './history'
export default History

declare global {
  interface Commands {
    undo: () => boolean
    redo: () => boolean
  }
}
