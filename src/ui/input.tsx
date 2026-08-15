/**
 * Input bar — a small controlled text input built on Ink's useInput.
 *
 * Controlled (unlike @inkjs/ui's TextInput): the value clears on submit and
 * the component owns no hidden state. Left/right arrows move the cursor,
 * backspace deletes, Enter submits. Registers with Ink's focus manager so
 * Tab cycles between the three panels.
 *
 * @module dsh-tui-astra/ui/input
 */

import { useState } from 'react'
import type { JSX } from 'react'
import { Box, Text, useFocus, useInput } from 'ink'

export interface InputProps {
  /** Called with the submitted text (trimmed, non-empty). */
  onSubmit: (text: string) => void
}

export function Input({ onSubmit }: InputProps): JSX.Element {
  const { isFocused } = useFocus()
  const [value, setValue] = useState('')
  const [cursor, setCursor] = useState(0)

  useInput((input, key) => {
    if (key.return) {
      const text = value
      setValue('')
      setCursor(0)
      if (text.trim() !== '') onSubmit(text)
      return
    }
    if (key.leftArrow) {
      setCursor((current) => Math.max(0, current - 1))
      return
    }
    if (key.rightArrow) {
      setCursor((current) => Math.min(value.length, current + 1))
      return
    }
    if (key.backspace || key.delete) {
      if (cursor === 0) return
      setValue((current) => current.slice(0, cursor - 1) + current.slice(cursor))
      setCursor((current) => Math.max(0, current - 1))
      return
    }
    if (key.ctrl || key.meta || key.escape || key.tab) return
    if (input.length === 1) {
      setValue((current) => current.slice(0, cursor) + input + current.slice(cursor))
      setCursor((current) => current + 1)
    }
  }, { isActive: isFocused })

  const before = value.slice(0, cursor)
  const after = value.slice(cursor)

  return (
    <Box paddingX={1}>
      <Text color="cyan">❯ </Text>
      {value === '' && !isFocused ? (
        <Text dimColor>ask the agent — Enter sends, Tab switches panels</Text>
      ) : (
        <Text>
          {before}
          {isFocused && <Text color="cyan" inverse> </Text>}
          {after}
        </Text>
      )}
    </Box>
  )
}
