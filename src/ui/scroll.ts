/**
 * Line-based scrolling for the chat and activity panels.
 *
 * Both panels render their content as a flat list of text rows (long messages
 * wrap into several rows). This hook keeps a row window of `maxVisible` lines
 * anchored at the bottom until the user scrolls up; new content then keeps
 * the window in place instead of yanking it down.
 *
 * @module dsh-tui-astra/ui/scroll
 */

import { useCallback, useEffect, useRef, useState } from 'react'

/** Named colors used by the panels; a subset of Ink's color space. */
export type RowColor = 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'gray' | 'white'

/** One displayable row; `key` must be stable across renders. */
export interface Row {
  key: string
  text: string
  color?: RowColor
  dim?: boolean
}

export interface LineScroll {
  /** The rows to render (at most `maxVisible`). */
  visible: readonly Row[]
  /** True when the window is pinned at the bottom (auto-follow). */
  atBottom: boolean
  scrollUp: () => void
  scrollDown: () => void
  scrollTop: () => void
  scrollBottom: () => void
}

/**
 * Scroll state over a growing row list.
 * @param rows - all rows, newest last.
 * @param maxVisible - number of lines the panel can show.
 * @returns the visible window and scroll controls.
 */
export function useLineScroll(rows: readonly Row[], maxVisible: number): LineScroll {
  const [offset, setOffset] = useState(0)
  const atBottom = offset === 0
  const pinnedRef = useRef(true)
  pinnedRef.current = atBottom

  // New rows arrive: stay pinned at the bottom, otherwise keep the window
  // anchored to the same content (offset from the end stays put; clamp when
  // the list shrank).
  const previousLength = useRef(0)
  useEffect(() => {
    const delta = rows.length - previousLength.current
    previousLength.current = rows.length
    if (pinnedRef.current) {
      setOffset(0)
    } else if (delta > 0) {
      // Content above the window grows: push the window down by the delta so
      // the same rows stay visible, but never below the clamp.
      setOffset((current) => Math.min(current + delta, Math.max(0, rows.length - maxVisible)))
    }
  }, [rows.length, maxVisible, rows])

  const scrollUp = useCallback(() => {
    setOffset((current) => Math.min(current + 1, Math.max(0, rows.length - maxVisible)))
  }, [rows.length, maxVisible])

  const scrollDown = useCallback(() => {
    setOffset((current) => Math.max(0, current - 1))
  }, [])

  const scrollTop = useCallback(() => {
    setOffset(Math.max(0, rows.length - maxVisible))
  }, [rows.length, maxVisible])

  const scrollBottom = useCallback(() => {
    setOffset(0)
  }, [])

  const visible = rows.slice(Math.max(0, rows.length - maxVisible - offset), rows.length - offset)

  return { visible, atBottom, scrollUp, scrollDown, scrollTop, scrollBottom }
}
