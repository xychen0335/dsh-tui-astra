/** Keyboard-driven saved-session picker rendered as a pi-tui overlay. */

import { matchesKey, SelectList, type Component } from '@earendil-works/pi-tui'
import { basename } from 'node:path'
import type { SavedSession } from '../sessions.ts'
import { boxedLines, fitTerminalText, terminalWidth } from './width.ts'

const BLUE = '\u001b[38;2;77;141;255m'
const DIM = '\u001b[90m'
const RESET = '\u001b[0m'

export interface SessionPickerCallbacks {
  onSelect: (session: SavedSession) => void
  onCancel: () => void
}

export class SessionPickerComponent implements Component {
  private sessions: readonly SavedSession[] = []
  private loading = true
  private error: string | undefined
  private list: SelectList | undefined

  constructor(private readonly callbacks: SessionPickerCallbacks) {}

  setLoading(): void {
    this.loading = true
    this.error = undefined
    this.list = undefined
  }

  setSessions(sessions: readonly SavedSession[]): void {
    this.sessions = sessions
    this.loading = false
    this.error = undefined
    const items = sessions.map((session) => ({
      value: session.id,
      label: session.title ?? (basename(session.workspace) || 'Untitled session'),
      description: `${session.workspace} · ${shortSessionId(session.id)} · ${relativeTime(session.updatedAt)}`,
    }))
    this.list = new SelectList(items, 8, {
      selectedPrefix: (text) => `${BLUE}${text}${RESET}`,
      selectedText: (text) => `${BLUE}${text}${RESET}`,
      description: (text) => `${DIM}${text}${RESET}`,
      scrollInfo: (text) => `${DIM}${text}${RESET}`,
      noMatch: (text) => `${DIM}${text}${RESET}`,
    })
    this.list.onSelect = (item) => {
      const session = this.sessions.find((candidate) => candidate.id === item.value)
      if (session !== undefined) this.callbacks.onSelect(session)
    }
    this.list.onCancel = this.callbacks.onCancel
  }

  setError(error: string): void {
    this.loading = false
    this.error = error
    this.list = undefined
  }

  render(width: number): string[] {
    const frameWidth = terminalWidth(width)
    if (frameWidth === 0) return []
    const innerWidth = Math.max(1, frameWidth - 4)
    const lines = [
      `${BLUE}Resume a session${RESET}`,
      `${DIM}↑↓ navigate · Enter resume · Esc close${RESET}`,
    ]
    if (this.loading) {
      lines.push(`${BLUE}Loading saved sessions…${RESET}`)
    } else if (this.error !== undefined) {
      lines.push(`\u001b[31m${fitTerminalText(this.error, innerWidth)}${RESET}`)
    } else if (this.list === undefined || this.sessions.length === 0) {
      lines.push(`${DIM}No saved sessions found${RESET}`)
    } else {
      lines.push(...this.list.render(innerWidth))
    }
    return boxedLines(lines, frameWidth)
  }

  handleInput(data: string): void {
    if (matchesKey(data, 'escape')) {
      this.callbacks.onCancel()
      return
    }
    this.list?.handleInput(data)
  }

  invalidate(): void {
    this.list?.invalidate()
  }
}

export function shortSessionId(id: string): string {
  return id.length <= 24 ? id : `${id.slice(0, 16)}…${id.slice(-6)}`
}

export function relativeTime(updatedAt: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - updatedAt) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return days < 30 ? `${days}d ago` : new Date(updatedAt).toLocaleDateString()
}
