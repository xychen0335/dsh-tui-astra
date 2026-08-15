/** Named colors used by the terminal row renderers. */
export type RowColor = 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'gray' | 'white'

/** One displayable row; `key` must be stable across renders. */
export interface Row {
  key: string
  text: string
  color?: RowColor
  dim?: boolean
  bold?: boolean
}
