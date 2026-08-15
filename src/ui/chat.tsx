/**
 * Chat panel — the conversation surface.
 *
 * Completed messages are committed once to Ink Static so the terminal owns
 * transcript scrollback, selection, copy, and search. Only the trailing
 * streaming assistant message stays in Ink's dynamic render area.
 *
 * @module dsh-tui-astra/ui/chat
 */

import { useMemo } from 'react'
import type { JSX } from 'react'
import { Box, Static, Text } from 'ink'
import type { ChatMessage, Store, UiState } from '../store.ts'
import { useStore } from '../store.ts'
import type { Row } from './row.ts'
import { Header } from './header.tsx'

/** All logical chat rows, before terminal-width wrapping. */
export function chatRows(state: UiState): Row[] {
  const rows: Row[] = []
  for (const message of state.messages) {
    rows.push(...messageRows(message))
  }
  if (rows.length === 0) {
    rows.push({ key: 'empty', text: 'Start a task, ask a question, or type /help.', dim: true })
  }
  return rows
}

/** All logical rows for one message, before terminal-width wrapping. */
export function messageRows(message: ChatMessage): Row[] {
  const rows: Row[] = [{
    key: `${message.id}/head`,
    text: message.role === 'user' ? '› You' : '• dsh',
    bold: true,
  }]
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

interface TranscriptBanner {
  kind: 'banner'
  provider: string
  model: string
  workspace: string
}

interface TranscriptMessage {
  kind: 'message'
  message: ChatMessage
}

type TranscriptItem = TranscriptBanner | TranscriptMessage

export function Chat({ store, height, width }: ChatProps): JSX.Element {
  const state = useStore(store)
  const contentWidth = Math.max(1, width - 4)
  const headerWidth = Math.min(68, Math.max(28, width - 2))
  const transcriptItems = useMemo<TranscriptItem[]>(() => [
    {
      kind: 'banner',
      provider: state.provider,
      model: state.model,
      workspace: state.workspace,
    },
    ...state.messages
      .filter((message) => !message.streaming)
      .map((message): TranscriptMessage => ({ kind: 'message', message })),
  ], [state.messages, state.provider, state.model, state.workspace])
  const streamingMessage = state.messages[state.messages.length - 1]?.streaming
    ? state.messages[state.messages.length - 1]
    : undefined
  const streamingRows = streamingMessage === undefined
    ? []
    : wrapRows(messageRows(streamingMessage), contentWidth)

  return (
    <>
      <Static
        key={state.transcriptGeneration}
        items={transcriptItems}
      >
        {(item, index) => {
          if (item.kind === 'banner') {
            const bannerState = {
              ...state,
              provider: item.provider,
              model: item.model,
              workspace: item.workspace,
            }
            return <Header key={`banner/${index}`} state={bannerState} width={headerWidth} />
          }
          const rows = wrapRows(messageRows(item.message), contentWidth)
          return (
            <Box
              key={`${item.message.role}/${item.message.id}`}
              flexDirection="column"
              paddingX={2}
              paddingTop={index === 1 ? 1 : 0}
            >
              {rows.map((row) => (
                <Text key={row.key} color={row.color} dimColor={row.dim} bold={row.bold}>{row.text}</Text>
              ))}
            </Box>
          )
        }}
      </Static>
      <Box flexDirection="column" height={height} paddingX={2} paddingTop={1}>
        {state.messages.length === 0 && (
          <Text dimColor>Start a task, ask a question, or type /help.</Text>
        )}
        {streamingRows.map((row) => (
          <Text key={row.key} color={row.color} dimColor={row.dim} bold={row.bold}>{row.text}</Text>
        ))}
      </Box>
    </>
  )
}
