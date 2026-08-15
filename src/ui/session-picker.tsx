/** Keyboard-driven saved-session picker shown by /resume and /sessions. */

import { useEffect, useState } from 'react'
import type { JSX } from 'react'
import { Box, Text, useInput } from 'ink'
import { basename } from 'node:path'
import type { SavedSession } from '../sessions.ts'
import { DEEPSEEK_BLUE, DEEPSEEK_BLUE_DARK } from './theme.ts'

export interface SessionPickerProps {
  sessions: readonly SavedSession[]
  loading: boolean
  error?: string
  onSelect: (session: SavedSession) => void
  onCancel: () => void
}

export function SessionPicker({ sessions, loading, error, onSelect, onCancel }: SessionPickerProps): JSX.Element {
  const [selected, setSelected] = useState(0)

  useEffect(() => {
    setSelected((current) => Math.min(current, Math.max(0, sessions.length - 1)))
  }, [sessions.length])

  useInput((_input, key) => {
    if (key.escape) {
      onCancel()
      return
    }
    if (loading || sessions.length === 0) return
    if (key.upArrow) {
      setSelected((current) => (current - 1 + sessions.length) % sessions.length)
      return
    }
    if (key.downArrow) {
      setSelected((current) => (current + 1) % sessions.length)
      return
    }
    if (key.return) {
      const session = sessions[selected]
      if (session !== undefined) onSelect(session)
    }
  })

  return (
    <Box flexDirection="column" marginX={1} borderStyle="round" borderColor={DEEPSEEK_BLUE} paddingX={1}>
      <Box>
        <Text color={DEEPSEEK_BLUE} bold>Resume a session</Text>
        <Box flexGrow={1} />
        <Text dimColor>↑↓ navigate  Enter resume  Esc close</Text>
      </Box>
      {loading && <Text color={DEEPSEEK_BLUE}>  Loading saved sessions…</Text>}
      {!loading && error !== undefined && <Text color="red">  {error}</Text>}
      {!loading && error === undefined && sessions.length === 0 && (
        <Text dimColor>  No saved sessions found</Text>
      )}
      {!loading && sessions.map((session, index) => {
        const active = index === selected
        const title = session.title ?? (basename(session.workspace) || 'Untitled session')
        return (
          <Box key={session.id} flexDirection="column">
            <Box>
              <Text color={active ? DEEPSEEK_BLUE : 'gray'} bold={active}>
                {active ? '› ' : '  '}
              </Text>
              <Text
                color={active ? 'white' : undefined}
                backgroundColor={active ? DEEPSEEK_BLUE_DARK : undefined}
                bold={active}
              >
                {title}
              </Text>
              <Box flexGrow={1} />
              <Text color={active ? DEEPSEEK_BLUE : 'gray'}>{relativeTime(session.updatedAt)}</Text>
            </Box>
            <Box paddingLeft={2}>
              <Text dimColor={!active} color={active ? 'white' : undefined}>
                {session.workspace}  ·  {shortSessionId(session.id)}
              </Text>
            </Box>
          </Box>
        )
      })}
    </Box>
  )
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
