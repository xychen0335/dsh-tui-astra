/**
 * Footer — quiet model/workspace context and compact progress counters.
 *
 * @module dsh-tui-astra/ui/status
 */

import { useMemo } from 'react'
import type { JSX } from 'react'
import { Box, Text } from 'ink'
import type { UiState } from '../store.ts'

export function Status({ state, width }: { state: UiState; width: number }): JSX.Element {
  const counts = useMemo(() => {
    let ok = 0
    let failed = 0
    for (const activity of state.activities) {
      // Only completed tool results count as outcomes; pending tool-call
      // activities are not successes.
      if (activity.kind === 'tool' && activity.result === true) {
        if (activity.error) failed += 1
        else ok += 1
      }
    }
    return { ok, failed }
  }, [state.activities])

  const todoSummary = todoText(state.todos)
  const context = `${state.provider}/${state.model} · ${state.workspace}`
  const outcomes = counts.ok + counts.failed === 0 ? '' : ` · tools ${counts.ok}✓ ${counts.failed}✗`
  const agents = state.activeSubagents === 0 ? '' : ` · agents ${state.activeSubagents}`
  const progress = `${todoSummary === '' ? '' : ` · ${todoSummary}`}${agents}${outcomes}`
  const hint = state.phase === 'running' ? 'Esc interrupt' : '/ commands'
  const footer = truncate(`${hint} · ${context}${progress}`, Math.max(1, width - 2))
  return (
    <Box paddingX={1}>
      <Text dimColor>{footer}</Text>
    </Box>
  )
}

function truncate(text: string, width: number): string {
  if (text.length <= width) return text
  if (width <= 1) return '…'
  return `${text.slice(0, width - 1)}…`
}

function todoText(todos: readonly UiState['todos'][number][]): string {
  if (todos.length === 0) return ''
  const done = todos.filter((todo) => todo.status === 'completed').length
  const active = todos.find((todo) => todo.status === 'in_progress')
  const activeText = active === undefined ? '' : ` · ${active.content.slice(0, 40)}`
  return `${done}/${todos.length} todos${activeText}`
}
