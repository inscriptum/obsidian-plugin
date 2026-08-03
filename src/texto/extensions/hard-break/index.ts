import { HardBreak } from './hard-break'

export * from './hard-break'
export default HardBreak

declare global {
  interface Commands {
    setHardBreak: () => any
  }
}
