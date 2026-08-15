/**
 * Input bar — a small controlled text input built on Ink's useInput.
 *
 * Controlled (unlike @inkjs/ui's TextInput): the value clears on submit and
 * the component owns no hidden state. Left/right arrows move the cursor,
 * backspace deletes, Enter submits.
 *
 * @module dsh-tui-astra/ui/input
 */

import { useEffect, useMemo, useState } from 'react'
import type { JSX } from 'react'
import { Box, Text, useInput } from 'ink'
import { matchingCommands } from './commands.ts'
import { DEEPSEEK_BLUE } from './theme.ts'

export interface InputProps {
  /** Called with the submitted text (trimmed, non-empty). */
  onSubmit: (text: string) => void
  /** Reports palette height so the transcript can yield terminal rows. */
  onPaletteRowsChange?: (rows: number) => void
  /** Disable text capture while a modal picker owns the keyboard. */
  isActive?: boolean
}

export function Input({ onSubmit, onPaletteRowsChange, isActive = true }: InputProps): JSX.Element {
  // This is the only text-entry surface. Ink reserves Esc for clearing focus,
  // so tying input activity to useFocus would make Esc interruption disable
  // all subsequent typing. Keep the composer active independently of focus.
  const [value, setValue] = useState('')
  const [cursor, setCursor] = useState(0)
  const [history, setHistory] = useState<readonly string[]>([])
  const [historyIndex, setHistoryIndex] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [selected, setSelected] = useState(0)
  const [paletteDismissed, setPaletteDismissed] = useState(false)
  const matches = useMemo(
    () => paletteDismissed ? [] : matchingCommands(value),
    [paletteDismissed, value],
  )

  useEffect(() => {
    setSelected(0)
    setPaletteDismissed(false)
  }, [value])

  useEffect(() => {
    onPaletteRowsChange?.(matches.length)
  }, [matches.length, onPaletteRowsChange])

  useInput((input, key) => {
    // Mouse reporting is enabled for transcript wheel/trackpad scrolling.
    // Ink does not classify SGR mouse sequences, so never treat them as text.
    if (/\[<\d+;\d+;\d+[Mm]/.test(input)) return
    if (key.return) {
      const text = value
      setValue('')
      setCursor(0)
      setHistoryIndex(null)
      setDraft('')
      if (text.trim() !== '') {
        setHistory((current) => current[current.length - 1] === text ? current : [...current, text].slice(-100))
        onSubmit(text)
      }
      return
    }
    if (key.escape && matches.length > 0) {
      setPaletteDismissed(true)
      return
    }
    if (key.tab && matches.length > 0) {
      const match = matches[selected]
      if (match !== undefined) {
        const completed = `${match.name}${match.args === '' ? '' : ' '}`
        setValue(completed)
        setCursor(completed.length)
      }
      return
    }
    if (key.upArrow && !key.ctrl && !key.meta) {
      if (matches.length > 0) {
        setSelected((current) => (current - 1 + matches.length) % matches.length)
      } else if (history.length > 0 && (value === '' || historyIndex !== null)) {
        const next = historyIndex === null ? history.length - 1 : Math.max(0, historyIndex - 1)
        if (historyIndex === null) setDraft(value)
        const recalled = history[next] ?? ''
        setHistoryIndex(next)
        setValue(recalled)
        setCursor(recalled.length)
      }
      return
    }
    if (key.downArrow && !key.ctrl && !key.meta) {
      if (matches.length > 0) {
        setSelected((current) => (current + 1) % matches.length)
      } else if (historyIndex !== null) {
        const next = historyIndex + 1
        if (next >= history.length) {
          setHistoryIndex(null)
          setValue(draft)
          setCursor(draft.length)
        } else {
          const recalled = history[next] ?? ''
          setHistoryIndex(next)
          setValue(recalled)
          setCursor(recalled.length)
        }
      }
      return
    }
    if (key.leftArrow) {
      setCursor((current) => previousGraphemeBoundary(value, current))
      return
    }
    if (key.rightArrow) {
      setCursor((current) => nextGraphemeBoundary(value, current))
      return
    }
    if (key.backspace || key.delete) {
      if (cursor === 0) return
      const previous = previousGraphemeBoundary(value, cursor)
      setValue((current) => current.slice(0, previous) + current.slice(cursor))
      setCursor(previous)
      setHistoryIndex(null)
      return
    }
    if (key.ctrl || key.meta || key.escape || key.tab || key.return) return
    if (input === '') return
    // Terminal paste arrives as one multi-character input; insert it whole
    // (also covers non-BMP characters, whose JS length is 2).
    setValue((current) => current.slice(0, cursor) + input + current.slice(cursor))
    setCursor((current) => current + input.length)
    setHistoryIndex(null)
  }, { isActive })

  const before = value.slice(0, cursor)
  const after = value.slice(cursor)

  return (
    <Box flexDirection="column" marginX={1}>
      {matches.map((command, index) => (
        <Box key={command.name} paddingX={1}>
          <Text color={index === selected ? DEEPSEEK_BLUE : undefined} bold={index === selected}>
            {index === selected ? '› ' : '  '}{command.name}
          </Text>
          {command.args !== '' && <Text dimColor> {command.args}</Text>}
          <Text dimColor>  {command.description}</Text>
        </Box>
      ))}
      <Box
        width="100%"
        minHeight={3}
        borderStyle="round"
        borderColor={isActive ? DEEPSEEK_BLUE : 'gray'}
        paddingX={1}
      >
        <Text color={isActive ? DEEPSEEK_BLUE : 'gray'} bold>› </Text>
        {value === '' ? (
          <Text>
            {isActive && <Text color={DEEPSEEK_BLUE} inverse> </Text>}
            <Text dimColor>{isActive
              ? ' Describe a task, @file, or type / for commands'
              : ' Select a session above'}</Text>
          </Text>
        ) : (
          <Text>
            {before}
            {isActive && <Text color={DEEPSEEK_BLUE} inverse> </Text>}
            {after}
          </Text>
        )}
      </Box>
    </Box>
  )
}

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** Return the preceding Unicode grapheme boundary for a UTF-16 offset. */
export function previousGraphemeBoundary(text: string, offset: number): number {
  let previous = 0
  for (const segment of graphemeSegmenter.segment(text)) {
    if (segment.index >= offset) break
    previous = segment.index
  }
  return previous
}

/** Return the following Unicode grapheme boundary for a UTF-16 offset. */
export function nextGraphemeBoundary(text: string, offset: number): number {
  for (const segment of graphemeSegmenter.segment(text)) {
    if (segment.index > offset) return segment.index
  }
  return text.length
}
