/**
 * Activity feed — a terse inline event stream beneath the transcript.
 *
 * @module dsh-tui-astra/ui/activity
 */

import type { JSX } from 'react'
import { Box, Text } from 'ink'
import type { Activity, ActivityKind, Store } from '../store.ts'
import { useStore } from '../store.ts'
import type { Row, RowColor } from './row.ts'

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

/** All activity rows, one per line (details wrapped as indented rows). */
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
  if (rows.length === 0) {
    rows.push({ key: 'empty', text: 'activity will appear here', dim: true })
  }
  return rows
}

export interface ActivityFeedProps {
  store: Store
  height: number
}

export function ActivityFeed({ store, height }: ActivityFeedProps): JSX.Element {
  const state = useStore(store)
  const phaseRow: Row | undefined = state.phase === 'starting'
    ? { key: 'phase', text: '• Starting runtime…', color: 'blue' }
    : state.phase === 'running'
      ? { key: 'phase', text: '• Working…', color: 'yellow' }
      : undefined
  const rows = activityRows(state.activities).filter((row) => row.key !== 'empty')
  const activityLimit = Math.max(0, height - (phaseRow === undefined ? 0 : 1))
  const visible = activityLimit === 0 ? [] : rows.slice(-activityLimit)

  return (
    <Box flexDirection="column" height={height} paddingX={2}>
      {phaseRow !== undefined && <Text color={phaseRow.color}>{phaseRow.text}</Text>}
      {visible.map((row) => (
        <Text key={row.key} color={row.color} dimColor={row.dim}>{row.text}</Text>
      ))}
    </Box>
  )
}
