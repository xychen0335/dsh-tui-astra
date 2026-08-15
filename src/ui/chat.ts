/**
 * Main-screen conversation components.
 *
 * Completed messages are mounted into the document container. The active
 * assistant response is kept as one replaceable component in the dynamic
 * tail and is atomically promoted to the document on completion.
 */

import type { Component } from '@earendil-works/pi-tui'
import { wrapTextWithAnsi } from '@earendil-works/pi-tui'
import type { ChatMessage, UiState } from '../store.ts'
import type { Row } from './row.ts'
import { fitTerminalText, terminalWidth } from './width.ts'

const BLUE = '\u001b[38;2;77;141;255m'
const GRAY = '\u001b[90m'
const RESET = '\u001b[0m'
const BOLD = '\u001b[1m'

export function chatRows(state: UiState): Row[] {
  const rows: Row[] = []
  for (const message of state.messages) rows.push(...messageRows(message))
  if (rows.length === 0) {
    rows.push({ key: 'empty', text: 'Start a task, ask a question, or type /help.', dim: true })
  }
  return rows
}

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
      rows.push({ key: `${message.id}/t${i}`, text: `  ${line}` })
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

export class HeaderComponent implements Component {
  constructor(private state: UiState) {}

  update(state: UiState): void {
    this.state = state
  }

  render(width: number): string[] {
    const frameWidth = terminalWidth(width)
    if (frameWidth === 0) return []
    const lines = [
      `${BOLD}>_ dsh${RESET}`,
      `${GRAY}model:     ${RESET}${this.state.provider}/${this.state.model}`,
      `${GRAY}directory: ${RESET}${this.state.workspace}`,
    ]
    return [
      fitTerminalText(` ${'─'.repeat(Math.max(0, frameWidth - 2))} `, frameWidth, ''),
      ...lines.map((line) => fitTerminalText(` ${line}`, frameWidth, '')),
      fitTerminalText(` ${'─'.repeat(Math.max(0, frameWidth - 2))} `, frameWidth, ''),
    ]
  }

  invalidate(): void {}
}

export class MessageComponent implements Component {
  private readonly rows: Row[]

  constructor(message: ChatMessage) {
    this.rows = messageRows(message)
  }

  render(width: number): string[] {
    const contentWidth = Math.max(0, terminalWidth(width) - 4)
    if (contentWidth === 0) return []
    return this.rows.flatMap((row) => styleRow(row, contentWidth))
  }

  invalidate(): void {}
}

export class ConversationDocument implements Component {
  readonly children: Component[] = []
  private header: HeaderComponent
  private readonly messages = new Map<string, MessageComponent>()

  constructor(private state: UiState) {
    this.header = new HeaderComponent(state)
    this.children.push(this.header)
    this.rebuildMessages()
  }

  update(state: UiState): void {
    this.state = state
    this.header.update(state)
    const stableMessages = state.messages.filter((message) => !message.streaming)
    const ids = new Set(stableMessages.map((message) => message.id))
    for (const [id, component] of this.messages) {
      if (!ids.has(id)) {
        this.messages.delete(id)
        const index = this.children.indexOf(component)
        if (index >= 0) this.children.splice(index, 1)
      }
    }
    for (const message of stableMessages) {
      const existing = this.messages.get(message.id)
      if (existing !== undefined) {
        // Completed components are immutable document entries. A completed
        // message should never be rewritten by a later dynamic-tail update.
        continue
      } else {
        const component = new MessageComponent(message)
        this.messages.set(message.id, component)
        this.children.push(component)
      }
    }
  }

  render(width: number): string[] {
    const lines: string[] = []
    for (const child of this.children) lines.push(...child.render(width))
    if (this.children.length === 1) {
      lines.push(`${GRAY}Start a task, ask a question, or type /help.${RESET}`)
    }
    return lines
  }

  invalidate(): void {
    for (const child of this.children) child.invalidate()
  }

  reset(state: UiState): void {
    this.state = state
    this.children.splice(0)
    this.messages.clear()
    this.header = new HeaderComponent(state)
    this.children.push(this.header)
    this.rebuildMessages()
  }

  private rebuildMessages(): void {
    for (const message of this.state.messages) {
      if (message.streaming) continue
      const component = new MessageComponent(message)
      this.messages.set(message.id, component)
      this.children.push(component)
    }
  }
}

export class StreamingComponent implements Component {
  private message: ChatMessage | undefined

  update(message: ChatMessage | undefined): void {
    this.message = message
  }

  render(width: number): string[] {
    if (this.message === undefined) return []
    return new MessageComponent(this.message).render(width)
  }

  invalidate(): void {}
}

export class RowsComponent implements Component {
  constructor(private getRows: () => readonly Row[], private readonly minRows = 0) {}

  render(width: number): string[] {
    const rows = this.getRows()
    const rendered = rows.slice(-Math.max(this.minRows, rows.length)).flatMap((row) => styleRow(row, width))
    return rendered
  }

  invalidate(): void {}
}

function styleRow(row: Row, width: number): string[] {
  const maxWidth = terminalWidth(width)
  if (maxWidth === 0) return []
  const wrapped = wrapTextWithAnsi(row.text, maxWidth)
  const color = row.color === 'blue' ? BLUE : row.color === 'gray' ? GRAY : row.color === 'red' ? '\u001b[31m' : ''
  return wrapped.map((text) => fitTerminalText(
    `${row.bold ? BOLD : ''}${color}${row.dim ? GRAY : ''}${text}${RESET}`,
    maxWidth,
    '',
  ))
}
