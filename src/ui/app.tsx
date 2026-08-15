/**
 * AstraApp — the root TUI component.
 *
 * Handles the global Ctrl+C exit path, routes submitted text to the bridge
 * (or handles slash commands), and lays out the fixed chrome (header / status
 * / input) around the two scrollable panels. Panel focus is Ink's own focus
 * manager: Tab cycles the useFocus-registered panels.
 *
 * @module dsh-tui-astra/ui/app
 */

import type { JSX } from 'react'
import { Box, Text, useInput } from 'ink'
import type { HarnessBridge } from '../harness/bridge.ts'
import type { Store } from '../store.ts'
import { useStore } from '../store.ts'
import { useTerminalSize } from './size.ts'
import { Header } from './header.tsx'
import { Chat } from './chat.tsx'
import { ActivityPanel } from './activity.tsx'
import { Status } from './status.tsx'
import { Input } from './input.tsx'

export interface AstraAppProps {
  store: Store
  bridge: HarnessBridge
  /** Clean shutdown: close the runtime, then exit with code 0. */
  quit: () => void
}

const KEY_HELP = [
  'keys: Tab switch panel · PageUp/PageDown scroll · Ctrl+C quit',
  'commands: /new [id] fresh session · /quit exit · /help this help',
].join('\n')

export function AstraApp({ store, bridge, quit }: AstraAppProps): JSX.Element {
  const state = useStore(store)
  const { rows: termRows, columns: termColumns } = useTerminalSize()

  const panelHeight = Math.max(3, termRows - 5)
  const activityWidth = Math.min(56, Math.max(28, Math.floor(termColumns / 3)))
  const chatWidth = Math.max(20, termColumns - activityWidth - 1)

  useInput((input, key) => {
    if (key.ctrl && input.toLowerCase() === 'c') {
      quit()
    }
  })

  const handleSubmit = (text: string): void => {
    if (text.startsWith('/')) {
      handleCommand(text)
      return
    }
    bridge.send(text).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      store.applyMany([{ kind: 'error', text: `send failed: ${message}` }])
    })
  }

  const handleCommand = (text: string): void => {
    const [command, ...rest] = text.trim().split(/\s+/)
    switch (command) {
      case '/quit':
      case '/exit':
        quit()
        return
      case '/new': {
        const id = rest[0]
        const sessionId = bridge.newSession(id)
        store.setSessionId(sessionId)
        store.applyMany([{ kind: 'note', text: id === undefined ? 'started a fresh session' : `switched to session ${id}` }])
        return
      }
      case '/help':
        store.applyMany([{ kind: 'note', text: KEY_HELP }])
        return
      default:
        store.applyMany([{ kind: 'note', text: `unknown command: ${command} — try /help` }])
    }
  }

  return (
    <Box flexDirection="column">
      <Header state={state} />
      <Box flexDirection="row">
        <Box width={chatWidth} flexGrow={1}>
          <Chat store={store} height={panelHeight} />
        </Box>
        <ActivityPanel store={store} height={panelHeight} width={activityWidth} />
      </Box>
      <Status state={state} />
      {state.error !== null && (
        <Box paddingX={1}>
          <Text color="red" bold>runtime error: {state.error}</Text>
        </Box>
      )}
      <Input onSubmit={handleSubmit} />
    </Box>
  )
}
