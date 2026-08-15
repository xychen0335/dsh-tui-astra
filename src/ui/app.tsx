/**
 * AstraApp — the root TUI component.
 *
 * Handles the global Ctrl+C exit path, routes submitted text to the bridge
 * (or handles slash commands), and lays out the fixed chrome (header / status
 * / input) around a compact single-column conversation.
 *
 * @module dsh-tui-astra/ui/app
 */

import { useEffect, useRef, useState } from 'react'
import type { JSX } from 'react'
import { Box, useInput } from 'ink'
import type { HarnessBridge } from '../harness/bridge.ts'
import type { Store } from '../store.ts'
import { useStore } from '../store.ts'
import { useTerminalSize } from './size.ts'
import { Header } from './header.tsx'
import { Chat } from './chat.tsx'
import { ActivityFeed } from './activity.tsx'
import { Status } from './status.tsx'
import { Input } from './input.tsx'
import { SessionPicker } from './session-picker.tsx'
import { ModelPicker } from './model-picker.tsx'
import type {
  RuntimeModelsResult,
  RuntimeProviderDescriptor,
  SaveProviderInput,
} from '../harness/model-protocol.ts'
import { classifySessionEvent } from '../harness/events.ts'
import { listSessions, loadSession } from '../sessions.ts'
import type { SavedSession } from '../sessions.ts'
import {
  LOCAL_COMMANDS,
  PROMPT_COMMANDS,
  mergeCommands,
  parseCommandLine,
} from './commands.ts'
import type { SlashCommand } from './commands.ts'

export interface AstraAppProps {
  store: Store
  bridge: HarnessBridge
  /** Clean shutdown: close the runtime, then exit with code 0. */
  quit: () => void
  sessionRoot: string
}

const KEY_HELP = [
  'keys: Esc interrupt · / menu · Tab complete · ↑/↓ select/history',
  'history: scroll/trackpad · Ctrl+↑/↓ line · PgUp/PgDn page · Home/End jump',
  'commands: /new /resume /sessions /clear /status /session /model',
  'agent: /init /review · exit: /quit · help: /help',
].join('\n')

interface SessionPickerState {
  sessions: readonly SavedSession[]
  loading: boolean
  error?: string
}

interface ModelPickerState extends RuntimeModelsResult {
  providers: readonly RuntimeProviderDescriptor[]
  loading: boolean
  busy: boolean
  error?: string
}

export function AstraApp({ store, bridge, quit, sessionRoot }: AstraAppProps): JSX.Element {
  const state = useStore(store)
  const { rows: termRows, columns: termColumns } = useTerminalSize()
  const [paletteRows, setPaletteRows] = useState(0)
  const [sessionPicker, setSessionPicker] = useState<SessionPickerState | null>(null)
  const [modelPicker, setModelPicker] = useState<ModelPickerState | null>(null)
  const [runtimeCommands, setRuntimeCommands] = useState<readonly SlashCommand[]>([])
  const [runtimeSkills, setRuntimeSkills] = useState<readonly SlashCommand[]>([])
  const interrupting = useRef(false)

  const latestActivity = state.activities[state.activities.length - 1]
  const activityHeight = Math.min(10, Math.max(3, latestActivity?.text.split('\n').length ?? 1))
  const pickerRows = sessionPicker === null ? 0 : Math.min(16, 4 + sessionPicker.sessions.length * 2)
  const modelRows = modelPicker === null
    ? 0
    : Math.min(18, modelPicker.loading ? 3 : 3 + modelPicker.groups.reduce((sum, group) => sum + group.models.length, 1))
  const chatHeight = Math.max(4, termRows - 10 - activityHeight - paletteRows - pickerRows - modelRows)
  const headerWidth = Math.min(68, Math.max(28, termColumns - 2))

  useInput((input, key) => {
    if (key.ctrl && input.toLowerCase() === 'c') {
      quit()
      return
    }
    if (key.escape && modelPicker === null && state.phase === 'running' && !interrupting.current) {
      interrupting.current = true
      store.beginInterrupt()
      void bridge.interrupt()
        .then(() => {
          store.applyMany([
            { kind: 'phase', status: 'idle' },
            { kind: 'note', text: 'turn interrupted · ready for the next message' },
          ])
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error)
          store.applyMany([{ kind: 'error', text: `interrupt failed: ${message}` }])
        })
        .finally(() => {
          interrupting.current = false
        })
    }
  })

  const note = (message: string): void => {
    store.applyMany([{ kind: 'note', text: message }])
  }

  const refreshRuntimeCommands = (): void => {
    const sessionId = bridge.getSessionId()
    void bridge.listCommands()
      .then((commands) => {
        if (bridge.getSessionId() !== sessionId) return
        setRuntimeCommands(commands.map((command) => ({
          name: command.name,
          description: command.description,
          ...(command.input === undefined ? {} : { inputHint: command.input.hint }),
          source: 'runtime' as const,
        })))
      })
      .catch((error: unknown) => {
        note(`cannot load runtime commands: ${error instanceof Error ? error.message : String(error)}`)
      })
  }

  const refreshRuntimeSkills = (): void => {
    const sessionId = bridge.getSessionId()
    void bridge.listSkills()
      .then((skills) => {
        if (bridge.getSessionId() !== sessionId) return
        setRuntimeSkills(skills.map((skill) => ({
          name: skill.name,
          description: skill.modelInvocable ? skill.description : `user only · ${skill.description}`,
          source: 'skill' as const,
          modelInvocable: skill.modelInvocable,
        })))
      })
      .catch((error: unknown) => {
        note(`cannot load skills: ${error instanceof Error ? error.message : String(error)}`)
      })
  }

  const refreshRuntimeCatalog = (): void => {
    refreshRuntimeCommands()
    refreshRuntimeSkills()
  }

  useEffect(() => {
    if (state.phase === 'idle' && (runtimeCommands.length === 0 || runtimeSkills.length === 0)) {
      refreshRuntimeCatalog()
    }
  }, [state.phase, state.sessionId, runtimeCommands.length, runtimeSkills.length])

  const resumeSession = (id: string): void => {
    if (state.phase === 'running' || state.phase === 'starting') {
      note('interrupt the current turn with Esc before resuming another session')
      return
    }
    setSessionPicker((current) => current === null ? null : { ...current, loading: true, error: undefined })
    void loadSession(sessionRoot, id)
      .then((session) => {
        if (session === undefined) {
          setSessionPicker((current) => current === null
            ? null
            : { ...current, loading: false, error: `Session not found: ${id}` })
          note(`session not found: ${id}`)
          return
        }
        bridge.newSession(session.id)
        store.restoreSession(session.id, session.events.flatMap(classifySessionEvent))
        setRuntimeCommands([])
        setRuntimeSkills([])
        refreshRuntimeCatalog()
        setSessionPicker(null)
        note(`resumed ${session.title ?? session.id} · ${session.workspace}`)
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error)
        setSessionPicker((current) => current === null
          ? null
          : { ...current, loading: false, error: message })
        note(`cannot resume ${id}: ${message}`)
      })
  }

  const openSessionPicker = (): void => {
    if (state.phase === 'running' || state.phase === 'starting') {
      note('interrupt the current turn with Esc before browsing sessions')
      return
    }
    setSessionPicker({ sessions: [], loading: true })
    void listSessions(sessionRoot, state.workspace, 6)
      .then((sessions) => {
        setSessionPicker({ sessions, loading: false })
      })
      .catch((error: unknown) => {
        setSessionPicker({
          sessions: [],
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        })
      })
  }

  const openModelPicker = (): void => {
    setModelPicker({
      current: { provider: state.provider, model: state.model },
      groups: [],
      failures: [],
      providers: [],
      loading: true,
      busy: false,
    })
    void Promise.all([bridge.listModels(), bridge.listProviders()])
      .then(([models, providers]) => {
        setModelPicker({ ...models, providers, loading: false, busy: false })
      })
      .catch((error: unknown) => {
        setModelPicker({
          current: { provider: state.provider, model: state.model },
          groups: [],
          failures: [],
          providers: [],
          loading: false,
          busy: false,
          error: error instanceof Error ? error.message : String(error),
        })
      })
  }

  const selectModel = (provider: string, model: string): void => {
    setModelPicker(current => current === null ? null : { ...current, busy: true, error: undefined })
    void bridge.selectModel(provider, model)
      .then((selected) => {
        store.applyMany([{ kind: 'context', provider: selected.provider, model: selected.model }])
        setModelPicker(null)
        note(`model switched · ${selected.provider}/${selected.model}`)
      })
      .catch((error: unknown) => {
        setModelPicker(current => current === null
          ? null
          : { ...current, busy: false, error: error instanceof Error ? error.message : String(error) })
      })
  }

  const saveProvider = (input: SaveProviderInput): void => {
    setModelPicker(current => current === null ? null : { ...current, busy: true, error: undefined })
    void bridge.saveProvider(input)
      .then(async ({ selected }) => {
        if (selected !== undefined) {
          store.applyMany([{ kind: 'context', provider: selected.provider, model: selected.model }])
          setModelPicker(null)
          note(`provider configured · ${selected.provider}/${selected.model}`)
          return
        }
        const [models, providers] = await Promise.all([bridge.listModels(), bridge.listProviders()])
        setModelPicker({ ...models, providers, loading: false, busy: false })
        note(`provider saved · ${input.provider}`)
      })
      .catch((error: unknown) => {
        setModelPicker(current => current === null
          ? null
          : { ...current, busy: false, error: error instanceof Error ? error.message : String(error) })
      })
  }

  const deleteProvider = (provider: string): void => {
    setModelPicker(current => current === null ? null : { ...current, busy: true, error: undefined })
    void bridge.deleteProvider(provider)
      .then(async () => {
        const [models, providers] = await Promise.all([bridge.listModels(), bridge.listProviders()])
        setModelPicker({ ...models, providers, loading: false, busy: false })
        note(`provider deleted · ${provider}`)
      })
      .catch((error: unknown) => {
        setModelPicker(current => current === null
          ? null
          : { ...current, busy: false, error: error instanceof Error ? error.message : String(error) })
      })
  }

  const testProvider = (input: Omit<SaveProviderInput, 'model' | 'select'>): void => {
    setModelPicker(current => current === null ? null : { ...current, busy: true, error: undefined })
    void bridge.testProvider(input)
      .then((models) => {
        setModelPicker(current => current === null
          ? null
          : {
              ...current,
              busy: false,
              error: models.length === 0
                ? 'Connection succeeded, but the provider returned no models.'
                : `Connection succeeded · ${models.slice(0, 5).map(model => model.id).join(', ')}${models.length > 5 ? ` · +${models.length - 5} more` : ''}`,
            })
      })
      .catch((error: unknown) => {
        setModelPicker(current => current === null
          ? null
          : { ...current, busy: false, error: error instanceof Error ? error.message : String(error) })
      })
  }

  const handleSubmit = (text: string): void => {
    const parsed = parseCommandLine(text)
    if (parsed !== undefined) {
      const command = parsed.name === 'exit'
        ? LOCAL_COMMANDS.find((candidate) => candidate.name === 'quit')
        : commands.find((candidate) => candidate.name === parsed.name)
      if (command === undefined) {
        note(`unknown command: /${parsed.name} — type / to browse commands`)
        return
      }
      if (command.source === 'runtime') {
        void bridge.executeCommand(text)
          .then((execution) => {
            if (!execution.matched) note(`runtime command disappeared: /${parsed.name}`)
            refreshRuntimeCatalog()
          })
          .catch((error: unknown) => {
            note(`/${parsed.name} failed: ${error instanceof Error ? error.message : String(error)}`)
          })
        return
      }
      if (command.source === 'skill') {
        bridge.send(text).catch((error: unknown) => {
          note(`/${parsed.name} failed: ${error instanceof Error ? error.message : String(error)}`)
        })
        return
      }
      handleCommand(parsed.name, parsed.rawInput)
      return
    }
    bridge.send(text).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      store.applyMany([{ kind: 'error', text: `send failed: ${message}` }])
    })
  }

  const handleCommand = (command: string, rawInput: string): void => {
    const rest = rawInput.trim().split(/\s+/).filter(Boolean)
    switch (command) {
      case 'quit':
      case 'exit':
        quit()
        return
      case 'new': {
        const id = rest[0]
        const sessionId = bridge.newSession(id)
        store.resetSession(sessionId)
        setRuntimeCommands([])
        setRuntimeSkills([])
        refreshRuntimeCatalog()
        note(id === undefined ? `started session ${sessionId}` : `switched to session ${id}`)
        return
      }
      case 'resume': {
        const id = rest[0]
        if (id === undefined) openSessionPicker()
        else resumeSession(id)
        return
      }
      case 'sessions':
        openSessionPicker()
        return
      case 'clear':
        store.clearView()
        note('screen cleared · current session retained')
        return
      case 'status':
        note(`${state.phase} · ${state.provider}/${state.model} · session ${state.sessionId ?? 'none'} · ${state.workspace}`)
        return
      case 'session':
        note(`session: ${state.sessionId ?? 'none'}`)
        return
      case 'model': {
        const requested = rest[0]
        if (requested === undefined) {
          openModelPicker()
          return
        }
        const separator = requested.indexOf('/')
        if (separator <= 0 || separator === requested.length - 1) {
          note('usage: /model or /model <provider>/<model>')
          return
        }
        selectModel(requested.slice(0, separator), requested.slice(separator + 1))
        return
      }
      case 'init':
        void bridge.send('Inspect this repository and create or update its concise agent instructions file with verified build, test, and project conventions.')
          .catch((error: unknown) => note(`init failed: ${error instanceof Error ? error.message : String(error)}`))
        return
      case 'review': {
        const scope = rawInput.trim() || 'the current uncommitted changes'
        void bridge.send(`Review ${scope}. Focus on correctness, regressions, security, and missing tests. Report findings by severity before suggesting fixes.`)
          .catch((error: unknown) => note(`review failed: ${error instanceof Error ? error.message : String(error)}`))
        return
      }
      case 'help':
        note(KEY_HELP)
        return
      default:
        note(`unknown command: /${command} — type / to browse commands`)
    }
  }

  const commands = mergeCommands(LOCAL_COMMANDS, PROMPT_COMMANDS, runtimeCommands, runtimeSkills)

  return (
    <Box flexDirection="column">
      <Header state={state} width={headerWidth} />
      <Chat store={store} height={chatHeight} width={termColumns} />
      <ActivityFeed store={store} height={activityHeight} />
      {sessionPicker !== null && (
        <SessionPicker
          sessions={sessionPicker.sessions}
          loading={sessionPicker.loading}
          error={sessionPicker.error}
          onSelect={(session) => { resumeSession(session.id) }}
          onCancel={() => { setSessionPicker(null) }}
        />
      )}
      {modelPicker !== null && (
        <ModelPicker
          groups={modelPicker.groups}
          providers={modelPicker.providers}
          current={modelPicker.current}
          loading={modelPicker.loading}
          busy={modelPicker.busy}
          error={modelPicker.error
            ?? (modelPicker.failures.map(failure => `${failure.name}: ${failure.message}`).join('\n') || undefined)}
          onSelect={selectModel}
          onSaveProvider={saveProvider}
          onTestProvider={testProvider}
          onDeleteProvider={deleteProvider}
          onCancel={() => { setModelPicker(null) }}
        />
      )}
      <Input
        onSubmit={handleSubmit}
        onPaletteRowsChange={setPaletteRows}
        isActive={sessionPicker === null && modelPicker === null}
        commands={commands}
      />
      <Status state={state} width={termColumns} />
    </Box>
  )
}
