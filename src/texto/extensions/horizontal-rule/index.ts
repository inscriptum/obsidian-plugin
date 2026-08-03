import { HorizontalRule } from './horizontal-rule'

export * from './horizontal-rule'
export default HorizontalRule

declare global {
  interface Commands {
    setHorizontalRule: () => any
  }
}
