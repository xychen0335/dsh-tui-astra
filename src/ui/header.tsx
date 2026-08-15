/**
 * Header — a compact Codex-style environment card.
 *
 * @module dsh-tui-astra/ui/header
 */

import type { JSX } from 'react'
import { Box, Text } from 'ink'
import type { UiState } from '../store.ts'

export function Header({ state, width }: { state: UiState; width: number }): JSX.Element {
  const contentWidth = Math.max(12, width - 4)
  const route = truncate(`${state.provider}/${state.model}`, Math.max(1, contentWidth - 7))
  const directory = truncate(state.workspace, Math.max(1, contentWidth - 11))
  return (
    <Box marginX={1} width={width} flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
      <Text bold>&gt;_ dsh</Text>
      <Text><Text dimColor>model:     </Text>{route}</Text>
      <Text><Text dimColor>directory: </Text>{directory}</Text>
    </Box>
  )
}

function truncate(text: string, width: number): string {
  if (text.length <= width) return text
  if (width <= 1) return '…'
  return `${text.slice(0, width - 1)}…`
}
