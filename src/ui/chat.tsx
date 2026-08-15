/**
 * Chat panel — the conversation surface.
 *
 * Renders store messages as flat rows (one per wrapped line), auto-follows
 * the newest output, and scrolls with PageUp/PageDown/arrows when focused.
 *
 * @module dsh-tui-astra/ui/chat
 */

import { useMemo } from 'react'
import type { JSX } from 'react'
import { Box, Text, useFocus, useInput } from 'ink'
import type { Store, UiState } from '../store.ts'
import { useStore } from '../store.ts'
import { useLineScroll } from './scroll.ts'
import type { Row } from './scroll.ts'

/** All chat rows, one per line. */
export function chatRows(state: UiState): Row[] {
  const rows: Row[] = []
  for (const message of state.messages) {
    rows.push({
      key: `${message.id}/head`,
      text: message.role === 'user' ? '❯ you' : '◈ dsh',
      dim: true,
    })
    if (message.reasoning !== '') {
      for (const [i, line] of message.reasoning.split('\n').entries()) {
        rows.push({ key: `${message.id}/r${i}`, text: line, dim: true })
      }
    }
    if (message.text === '' && message.streaming) {
      rows.push({ key: `${message.id}/wait`, text: '…', dim: true })
    } else if (message.text !== '') {
      for (const [i, line] of message.text.split('\n').entries()) {
        rows.push({
          key: `${message.id}/t${i}`,
          text: line,
          color: message.role === 'user' ? 'green' : undefined,
        })
      }
    }
    if (message.streaming && message.text !== '') {
      rows.push({ key: `${message.id}/cur`, text: '▍', color: 'cyan' })
    }
    if (!message.streaming && message.usage !== undefined) {
      rows.push({ key: `${message.id}/usage`, text: usageText(message.usage), dim: true })
    }
  }
  if (rows.length === 0) {
    rows.push({ key: 'empty', text: 'no messages yet — ask the agent below', dim: true })
  }
  return rows
}

function usageText(usage: { inputTokens: number; outputTokens: number; reasoningTokens?: number }): string {
  const reasoning = usage.reasoningTokens === undefined ? '' : ` (${usage.reasoningTokens} reasoning)`
  return `▲ ${usage.inputTokens} in / ${usage.outputTokens} out${reasoning}`
}

export interface ChatProps {
  store: Store
  height: number
}

export function Chat({ store, height }: ChatProps): JSX.Element {
  const { isFocused } = useFocus()
  const state = useStore(store)
  const rows = useMemo(() => chatRows(state), [state])
  const scroll = useLineScroll(rows, height)

  useInput((_input, key) => {
    if (key.pageUp || key.upArrow) scroll.scrollUp()
    else if (key.pageDown || key.downArrow) scroll.scrollDown()
    else if (key.home) scroll.scrollTop()
    else if (key.end) scroll.scrollBottom()
  }, { isActive: isFocused })

  return (
    <Box flexDirection="column" height={height} borderStyle="round" borderColor={isFocused ? 'cyan' : 'gray'} paddingX={1}>
      {scroll.visible.map((row) => (
        <Text key={row.key} color={row.color} dimColor={row.dim}>{row.text}</Text>
      ))}
      {!scroll.atBottom && <Text dimColor>↑ {rows.length - height} more lines</Text>}
    </Box>
  )
}
