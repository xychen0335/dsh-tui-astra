/**
 * Status bar — phase label, todo progress, and tool outcome counters.
 *
 * @module dsh-tui-astra/ui/status
 */

import { useMemo } from 'react'
import type { JSX } from 'react'
import { Box, Text } from 'ink'
import type { Activity, UiState } from '../store.ts'

const PHASE_LABEL: Record<UiState['phase'], string> = {
  starting: 'starting runtime…',
  idle: 'idle',
  running: 'agent running…',
  error: 'error',
}

export function Status({ state }: { state: UiState }): JSX.Element {
  const counts = useMemo(() => {
    let ok = 0
    let failed = 0
    for (const activity of state.activities) {
      if (activity.kind === 'tool') {
        if (activity.error) failed += 1
        else ok += 1
      }
    }
    return { ok, failed }
  }, [state.activities])

  const todoSummary = todoText(state.todos)
  const subagents = countSubagents(state.activities)

  return (
    <Box justifyContent="space-between" paddingX={1}>
      <Text>
        <Text color={state.phase === 'running' ? 'yellow' : state.phase === 'error' ? 'red' : 'green'}>
          {PHASE_LABEL[state.phase]}
        </Text>
        {todoSummary !== '' && <Text dimColor> · {todoSummary}</Text>}
      </Text>
      <Text dimColor>
        {subagents > 0 && `⑂ ${subagents} · `}
        tools {counts.ok}✓ {counts.failed}✗
      </Text>
    </Box>
  )
}

function todoText(todos: readonly UiState['todos'][number][]): string {
  if (todos.length === 0) return ''
  const done = todos.filter((todo) => todo.status === 'completed').length
  const active = todos.find((todo) => todo.status === 'in_progress')
  const activeText = active === undefined ? '' : ` · ${active.content.slice(0, 40)}`
  return `${done}/${todos.length} todos${activeText}`
}

function countSubagents(activities: readonly Activity[]): number {
  let count = 0
  for (const activity of activities) {
    if (activity.kind === 'subagent' && activity.text.includes('started')) count += 1
  }
  return count
}
