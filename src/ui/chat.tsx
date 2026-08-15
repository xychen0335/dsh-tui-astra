/**
 * Chat panel — the conversation surface.
 *
 * Renders store messages as flat rows (one per wrapped line), auto-follows
 * the newest output, and scrolls with PageUp/PageDown/arrows when focused.
 *
 * @module dsh-tui-astra/ui/chat
 */

import { useEffect, useMemo, useRef } from 'react'
import type { JSX } from 'react'
import { Box, Text, useInput, useStdin, useStdout } from 'ink'
import type { Store, UiState } from '../store.ts'
import { useStore } from '../store.ts'
import { useLineScroll } from './scroll.ts'
import type { Row } from './scroll.ts'

/** All logical chat rows, before terminal-width wrapping. */
export function chatRows(state: UiState): Row[] {
  const rows: Row[] = []
  for (const message of state.messages) {
    rows.push({
      key: `${message.id}/head`,
      text: message.role === 'user' ? '› You' : '• dsh',
      bold: true,
    })
    if (message.reasoning !== '') {
      for (const [i, line] of message.reasoning.split('\n').entries()) {
        rows.push({ key: `${message.id}/r${i}`, text: `  ${line}`, dim: true })
      }
    }
    if (message.text === '' && message.streaming) {
      rows.push({ key: `${message.id}/wait`, text: '…', dim: true })
    } else if (message.text !== '') {
      for (const [i, line] of message.text.split('\n').entries()) {
        rows.push({
          key: `${message.id}/t${i}`,
          text: `  ${line}`,
        })
      }
    }
    if (message.streaming && message.text !== '') {
      rows.push({ key: `${message.id}/cur`, text: '  ▍', color: 'blue' })
    }
    if (!message.streaming && message.usage !== undefined) {
      rows.push({ key: `${message.id}/usage`, text: usageText(message.usage), dim: true })
    }
  }
  if (rows.length === 0) {
    rows.push({ key: 'empty', text: 'Start a task, ask a question, or type /help.', dim: true })
  }
  return rows
}

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** Wrap logical rows into terminal display rows without splitting graphemes. */
export function wrapRows(rows: readonly Row[], width: number): Row[] {
  const safeWidth = Math.max(1, Math.floor(width))
  return rows.flatMap((row) => {
    const wrapped: Row[] = []
    let text = ''
    let cells = 0
    let part = 0

    for (const segment of graphemeSegmenter.segment(row.text)) {
      const segmentWidth = graphemeWidth(segment.segment)
      if (text !== '' && cells + segmentWidth > safeWidth) {
        wrapped.push({ ...row, key: `${row.key}/w${part}`, text })
        text = ''
        cells = 0
        part += 1
      }
      text += segment.segment
      cells += segmentWidth
    }

    wrapped.push({ ...row, key: `${row.key}/w${part}`, text })
    return wrapped
  })
}

function graphemeWidth(grapheme: string): number {
  if (/\p{Extended_Pictographic}|\p{Regional_Indicator}|\u20e3/u.test(grapheme)) return 2
  let width = 0
  for (const character of grapheme) {
    if (/\p{Mark}|\p{Default_Ignorable_Code_Point}/u.test(character)) continue
    const codePoint = character.codePointAt(0) ?? 0
    width += isWideCodePoint(codePoint) ? 2 : 1
  }
  return width
}

function isWideCodePoint(codePoint: number): boolean {
  return codePoint >= 0x1100 && (
    codePoint <= 0x115f
    || codePoint === 0x2329
    || codePoint === 0x232a
    || (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f)
    || (codePoint >= 0xac00 && codePoint <= 0xd7a3)
    || (codePoint >= 0xf900 && codePoint <= 0xfaff)
    || (codePoint >= 0xfe10 && codePoint <= 0xfe19)
    || (codePoint >= 0xfe30 && codePoint <= 0xfe6f)
    || (codePoint >= 0xff00 && codePoint <= 0xff60)
    || (codePoint >= 0xffe0 && codePoint <= 0xffe6)
    || (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  )
}

function usageText(usage: { inputTokens: number; outputTokens: number; reasoningTokens?: number }): string {
  const reasoning = usage.reasoningTokens === undefined ? '' : ` (${usage.reasoningTokens} reasoning)`
  return `▲ ${usage.inputTokens} in / ${usage.outputTokens} out${reasoning}`
}

export interface ChatProps {
  store: Store
  height: number
  width: number
}

export function Chat({ store, height, width }: ChatProps): JSX.Element {
  const state = useStore(store)
  const { stdin } = useStdin()
  const { stdout } = useStdout()
  const contentWidth = Math.max(1, width - 4)
  const viewportHeight = Math.max(1, height - 2)
  const rows = useMemo(() => wrapRows(chatRows(state), contentWidth), [contentWidth, state])
  const scroll = useLineScroll(rows, viewportHeight)
  const mouseScrollRef = useRef({ up: scroll.scrollUp, down: scroll.scrollDown })
  mouseScrollRef.current = { up: scroll.scrollUp, down: scroll.scrollDown }

  useEffect(() => {
    if (!stdin.isTTY || !stdout.isTTY) return

    const handleMouse = (chunk: Buffer | string): void => {
      const input = chunk.toString()
      const events = input.matchAll(/\u001b\[<(\d+);\d+;\d+[Mm]/g)
      for (const event of events) {
        const button = Number(event[1])
        if ((button & 64) === 0) continue
        if ((button & 1) === 0) mouseScrollRef.current.up(3)
        else mouseScrollRef.current.down(3)
      }
    }

    // Normal mouse tracking includes wheel/trackpad events; SGR mode keeps
    // coordinates unambiguous. Hold Shift for native terminal text selection.
    stdout.write('\u001b[?1000h\u001b[?1006h')
    stdin.on('data', handleMouse)
    return () => {
      stdin.off('data', handleMouse)
      stdout.write('\u001b[?1006l\u001b[?1000l')
    }
  }, [stdin, stdout])

  useInput((_input, key) => {
    if (key.pageUp) scroll.scrollUp(viewportHeight)
    else if (key.pageDown) scroll.scrollDown(viewportHeight)
    else if (key.ctrl && key.upArrow) scroll.scrollUp()
    else if (key.ctrl && key.downArrow) scroll.scrollDown()
    else if (key.home) scroll.scrollTop()
    else if (key.end) scroll.scrollBottom()
  })

  return (
    <Box flexDirection="column" height={height} paddingX={2} paddingTop={1}>
      {scroll.visible.map((row) => (
        <Text key={row.key} color={row.color} dimColor={row.dim} bold={row.bold}>{row.text}</Text>
      ))}
      <Text dimColor wrap="truncate-end">
        {scroll.atBottom
          ? '  scroll/trackpad · Ctrl+↑ history · PgUp page'
          : `  ${scroll.atTop ? 'top' : '↑ older'} · ${scroll.visibleStart}–${scroll.visibleEnd}/${scroll.total} · scroll · PgUp/PgDn · End latest`}
      </Text>
    </Box>
  )
}
