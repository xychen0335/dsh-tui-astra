/**
 * Header — title, phase dot, session id, and model route.
 *
 * @module dsh-tui-astra/ui/header
 */

import type { JSX } from 'react'
import { Box, Text } from 'ink'
import type { UiState } from '../store.ts'

const PHASE_DOT: Record<UiState['phase'], { symbol: string; color: string }> = {
  starting: { symbol: '◌', color: 'blue' },
  idle: { symbol: '●', color: 'green' },
  running: { symbol: '◐', color: 'yellow' },
  error: { symbol: '✖', color: 'red' },
}

export function Header({ state }: { state: UiState }): JSX.Element {
  const dot = PHASE_DOT[state.phase]
  return (
    <Box justifyContent="space-between" paddingX={1}>
      <Text>
        <Text color={dot.color}>{dot.symbol}</Text> dsh-tui-astra
        {state.sessionId !== null && <Text dimColor> · {state.sessionId.slice(0, 12)}</Text>}
      </Text>
      <Text dimColor>
        {state.provider}/{state.model}
      </Text>
    </Box>
  )
}
