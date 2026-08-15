/**
 * Activity panel — the live event stream (tools, turns, subagents, notes).
 *
 * @module dsh-tui-astra/ui/activity
 */

import { useMemo } from 'react'
import type { JSX } from 'react'
import { Box, Text, useFocus, useInput } from 'ink'
import type { Activity, ActivityKind, Store } from '../store.ts'
import { useStore } from '../store.ts'
import { useLineScroll } from './scroll.ts'
import type { Row, RowColor } from './scroll.ts'

const ICONS: Record<ActivityKind, string> = {
  tool: '⚙',
  turn: '▸',
  step: '·',
  subagent: '⑂',
  status: '●',
  note: 'ⓘ',
  error: '✖',
}

const KIND_COLORS: Record<ActivityKind, RowColor> = {
  tool: 'yellow',
  turn: 'magenta',
  step: 'gray',
  subagent: 'magenta',
  status: 'cyan',
  note: 'gray',
  error: 'red',
}

/** All activity rows, one per line (details wrapped as indented rows). */
export function activityRows(activities: readonly Activity[]): Row[] {
  const rows: Row[] = []
  for (const activity of activities) {
    const color = KIND_COLORS[activity.kind]
    rows.push({
      key: `${activity.id}/0`,
      text: `${ICONS[activity.kind]} ${activity.text}`,
      color,
      dim: activity.kind === 'step' || activity.kind === 'note',
    })
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

export interface ActivityPanelProps {
  store: Store
  height: number
  width: number
}

export function ActivityPanel({ store, height, width }: ActivityPanelProps): JSX.Element {
  const { isFocused } = useFocus()
  const state = useStore(store)
  const rows = useMemo(() => activityRows(state.activities), [state.activities])
  const scroll = useLineScroll(rows, height)

  useInput((_input, key) => {
    if (key.pageUp || key.upArrow) scroll.scrollUp()
    else if (key.pageDown || key.downArrow) scroll.scrollDown()
    else if (key.home) scroll.scrollTop()
    else if (key.end) scroll.scrollBottom()
  }, { isActive: isFocused })

  return (
    <Box flexDirection="column" width={width} height={height} borderStyle="round" borderColor={isFocused ? 'cyan' : 'gray'} paddingX={1}>
      <Text dimColor>activity</Text>
      {scroll.visible.map((row) => (
        <Text key={row.key} color={row.color} dimColor={row.dim}>{row.text}</Text>
      ))}
      {!scroll.atBottom && <Text dimColor>↑ {rows.length - height} more</Text>}
    </Box>
  )
}
