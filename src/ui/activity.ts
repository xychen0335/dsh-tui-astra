/**
 * Activity feed helpers and the live activity component.
 */

import { truncateToWidth, visibleWidth, type Component } from '@earendil-works/pi-tui'
import type { Activity, ActivityKind, UiState } from '../store.ts'
import type { Row, RowColor } from './row.ts'
import { terminalWidth } from './width.ts'

const ICONS: Record<ActivityKind, string> = {
  tool: '•',
  command: '›',
  turn: '◦',
  step: '  ',
  subagent: '◦',
  status: '•',
  note: '›',
  error: '×',
}

const KIND_COLORS: Record<ActivityKind, RowColor> = {
  tool: 'gray',
  command: 'blue',
  turn: 'gray',
  step: 'gray',
  subagent: 'gray',
  status: 'blue',
  note: 'gray',
  error: 'red',
}

export function activityRows(activities: readonly Activity[]): Row[] {
  const rows: Row[] = []
  for (const activity of activities) {
    const color = KIND_COLORS[activity.kind]
    for (const [i, line] of activity.text.split('\n').entries()) {
      rows.push({
        key: `${activity.id}/${i}`,
        text: i === 0 ? `${ICONS[activity.kind]} ${line}` : `  ${line}`,
        color,
        dim: activity.kind === 'step' || activity.kind === 'note',
      })
    }
    if (activity.detail !== undefined) {
      for (const [i, line] of activity.detail.split('\n').entries()) {
        rows.push({ key: `${activity.id}/d${i}`, text: `  ${line}`, dim: true })
      }
    }
  }
  return rows
}

export class ActivityComponent implements Component {
  constructor(private state: UiState) {}

  update(state: UiState): void {
    this.state = state
  }

  render(width: number): string[] {
    const rows = activityRows(this.state.activities)
    const phase = this.state.phase === 'starting'
      ? { text: '• Starting runtime…', color: 'blue' as const }
      : this.state.phase === 'running'
        ? { text: '• Working…', color: 'yellow' as const }
        : undefined
    const limit = Math.max(1, Math.min(8, Math.floor(this.state.workspace.length > 0 ? 8 : 4)))
    const visible = rows.slice(-limit)
    const result = visible.map((row) => formatRow(row, width))
    if (phase !== undefined) result.unshift(colorize(phase.text, phase.color, width))
    return result
  }

  invalidate(): void {}
}

function formatRow(row: Row, width: number): string {
  const color = row.color === 'blue'
    ? '\u001b[38;2;77;141;255m'
    : row.color === 'red'
      ? '\u001b[31m'
      : row.color === 'yellow'
        ? '\u001b[33m'
        : '\u001b[90m'
  const maxWidth = terminalWidth(width)
  const text = visibleWidth(row.text) > maxWidth
    ? truncateToWidth(row.text, maxWidth, '…')
    : row.text
  return `${color}${text}\u001b[0m`
}

function colorize(text: string, color: RowColor, width: number): string {
  const code = color === 'blue'
    ? '\u001b[38;2;77;141;255m'
    : color === 'yellow'
      ? '\u001b[33m'
      : '\u001b[90m'
  const clipped = visibleWidth(text) > terminalWidth(width)
    ? truncateToWidth(text, terminalWidth(width), '…')
    : text
  return `${code}${clipped}\u001b[0m`
}
