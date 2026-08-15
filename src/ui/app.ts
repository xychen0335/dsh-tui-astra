/**
 * Imperative application composition root for pi-tui.
 *
 * Store and the bridge remain the business seams. This class only owns
 * component lifetimes, focus, overlays, command routing, and render requests.
 */

import {
  CombinedAutocompleteProvider,
  Container,
  Editor,
  matchesKey,
  ProcessTerminal,
  type Terminal,
  type TUI,
  type TuiInputListenerResult,
  TuiMainScreen,
} from '@earendil-works/pi-tui'
import type { RuntimeCommandDescriptor, CommandsExecuteResult } from '../harness/command-protocol.ts'
import type { RuntimeSkillDescriptor } from '../harness/skill-protocol.ts'
import type {
  RuntimeModelsResult,
  RuntimeProviderDescriptor,
  RuntimeModelSelection,
  SaveProviderInput,
  TestProviderInput,
} from '../harness/model-protocol.ts'
import { classifySessionEvent } from '../harness/events.ts'
import { listSessions, loadSession } from '../sessions.ts'
import type { Store } from '../store.ts'
import {
  LOCAL_COMMANDS,
  PROMPT_COMMANDS,
  mergeCommands,
  parseCommandLine,
} from './commands.ts'
import type { SlashCommand } from './commands.ts'
import {
  ActivityComponent,
} from './activity.ts'
import {
  ConversationDocument,
  StreamingComponent,
} from './chat.ts'
import { ModelPickerComponent } from './model-picker.ts'
import { SessionPickerComponent } from './session-picker.ts'
import { StatusComponent } from './status.ts'

const KEY_HELP = [
  'keys: Esc interrupt · / menu · Tab complete · ↑/↓ select/history',
  'history: terminal wheel/trackpad · terminal search · select/copy',
  'commands: /new /resume /sessions /clear /status /session /model /provider',
  'agent: /init /review · exit: /quit · help: /help',
].join('\n')

export interface AstraAppOptions {
  store: Store
  bridge: AstraBridge
  quit: () => void
  sessionRoot: string
  terminal?: Terminal
  logDirectory?: string
}

export interface AstraBridge {
  getSessionId(): string
  newSession(id?: string): string
  send(text: string): Promise<string>
  executeCommand(line: string): Promise<CommandsExecuteResult>
  listCommands(): Promise<readonly RuntimeCommandDescriptor[]>
  listSkills(): Promise<readonly RuntimeSkillDescriptor[]>
  interrupt(): Promise<void>
  listModels(): Promise<RuntimeModelsResult>
  listProviders(): Promise<readonly RuntimeProviderDescriptor[]>
  selectModel(provider: string, model: string): Promise<RuntimeModelSelection>
  saveProvider(input: SaveProviderInput): Promise<{ selected?: RuntimeModelSelection }>
  deleteProvider(provider: string): Promise<void>
  testProvider(input: TestProviderInput): Promise<readonly { id: string; name: string }[]>
}

export class AstraApp {
  readonly tui: TUI
  private readonly store: Store
  private readonly bridge: AstraBridge
  private readonly quit: () => void
  private readonly sessionRoot: string
  private readonly document: ConversationDocument
  private readonly streaming = new StreamingComponent()
  private readonly activity: ActivityComponent
  private readonly status: StatusComponent
  private readonly editor: Editor
  private readonly documentContainer = new Container()
  private readonly dynamicContainer = new Container()
  private readonly footerContainer = new Container()
  private readonly root: Container
  private readonly listener: () => void
  private readonly unsubscribe: () => void
  private readonly unsubscribeInput: () => void
  private readonly interruptState = { active: false }
  private sessionPicker: SessionPickerComponent | undefined
  private modelPicker: ModelPickerComponent | undefined
  private runtimeCommands: readonly SlashCommand[] = []
  private runtimeSkills: readonly SlashCommand[] = []
  private catalogSessionId: string | undefined
  private catalogLoading = false
  private catalogReady = false
  private lastGeneration: number
  private stopped = false

  constructor(options: AstraAppOptions) {
    this.store = options.store
    this.bridge = options.bridge
    this.quit = options.quit
    this.sessionRoot = options.sessionRoot
    const terminal = options.terminal ?? new ProcessTerminal()
    this.tui = new TuiMainScreen(terminal, true, options.logDirectory)
    this.tui.setClearOnShrink(true)
    this.lastGeneration = this.store.getState().transcriptGeneration

    this.document = new ConversationDocument(this.store.getState())
    this.activity = new ActivityComponent(this.store.getState())
    this.status = new StatusComponent(this.store.getState())
    this.editor = new Editor(this.tui, {
      borderColor: (text) => `\u001b[38;2;77;141;255m${text}\u001b[0m`,
      selectList: {
        selectedPrefix: (text) => `\u001b[38;2;77;141;255m${text}\u001b[0m`,
        selectedText: (text) => `\u001b[38;2;77;141;255m${text}\u001b[0m`,
        description: (text) => `\u001b[90m${text}\u001b[0m`,
        scrollInfo: (text) => `\u001b[90m${text}\u001b[0m`,
        noMatch: (text) => `\u001b[90m${text}\u001b[0m`,
      },
    }, { paddingX: 1, autocompleteMaxVisible: 6 })
    this.editor.onSubmit = (text) => {
      this.editor.addToHistory(text)
      this.handleSubmit(text)
    }
    this.editor.onChange = () => {
      this.tui.requestRender()
    }

    this.documentContainer.addChild(this.document)
    this.dynamicContainer.addChild(this.streaming)
    this.dynamicContainer.addChild(this.activity)
    this.dynamicContainer.addChild(this.editor)
    this.footerContainer.addChild(this.status)
    // Main-screen rendering must not allocate a grow-sized blank viewport.
    // The document and dynamic tail are sequential terminal rows; TuiMainScreen
    // appends stable document growth to native scrollback and only rewrites the
    // tail at the bottom.
    this.root = new Container()
    this.root.addChild(this.documentContainer)
    this.root.addChild(this.dynamicContainer)
    this.root.addChild(this.footerContainer)
    this.tui.addChild(this.root)
    this.tui.setFocus(this.editor)
    this.listener = () => this.updateFromStore()
    this.unsubscribe = this.store.subscribe(this.listener)
    this.unsubscribeInput = this.tui.addInputListener((data) => {
      return this.handleInput(data)
    })
    this.refreshRuntimeCatalog()
    this.installAutocomplete()
  }

  start(): void {
    this.tui.start()
  }

  stop(): void {
    if (this.stopped) return
    this.stopped = true
    this.unsubscribe()
    this.unsubscribeInput()
    this.tui.setFocus(null)
    this.tui.stop()
  }

  getEditorText(): string {
    return this.editor.getText()
  }

  renderSnapshot(): string[] {
    return this.tui.render(this.tui.terminal.columns)
  }

  private updateFromStore(): void {
    const state = this.store.getState()
    if (state.transcriptGeneration !== this.lastGeneration) {
      this.lastGeneration = state.transcriptGeneration
      this.document.reset(state)
      this.streaming.update(undefined)
    } else {
      this.document.update(state)
    }
    this.activity.update(state)
    this.status.update(state)
    const activeMessage = state.messages.at(-1)
    this.streaming.update(activeMessage?.streaming === true ? activeMessage : undefined)
    if (state.phase === 'idle' && !this.catalogReady) this.refreshRuntimeCatalog()
    this.tui.requestRender()
  }

  private installAutocomplete(): void {
    const provider = new CombinedAutocompleteProvider(
      [...this.commandsForAutocomplete()],
      this.store.getState().workspace,
      null,
    )
    this.editor.setAutocompleteProvider(provider)
  }

  private commandsForAutocomplete(): Array<{
    name: string
    description: string
    argumentHint?: string
  }> {
    return mergeCommands(LOCAL_COMMANDS, PROMPT_COMMANDS, this.runtimeCommands, this.runtimeSkills).map((command) => ({
      name: command.name,
      description: command.description,
      ...(command.inputHint === undefined ? {} : { argumentHint: command.inputHint }),
    }))
  }

  private refreshRuntimeCatalog(): void {
    const sessionId = this.bridge.getSessionId()
    if (this.catalogLoading || (this.catalogReady && this.catalogSessionId === sessionId)) return
    this.catalogLoading = true
    void Promise.all([this.bridge.listCommands(), this.bridge.listSkills()])
      .then(([commands, skills]) => {
        if (this.bridge.getSessionId() !== sessionId) return
        this.runtimeCommands = commands.map((command) => ({
          name: command.name,
          description: command.description,
          ...(command.input === undefined ? {} : { inputHint: command.input.hint }),
          source: 'runtime' as const,
        }))
        this.runtimeSkills = skills.map((skill) => ({
          name: skill.name,
          description: skill.modelInvocable ? skill.description : `user only · ${skill.description}`,
          source: 'skill' as const,
          modelInvocable: skill.modelInvocable,
        }))
        this.catalogSessionId = sessionId
        this.catalogReady = true
        this.installAutocomplete()
      })
      .catch((error: unknown) => {
        // Startup can call this before the bridge has finished initializing.
        // The next idle store update retries without turning the race into a
        // visible activity error.
        if (this.catalogSessionId !== sessionId) return
        this.note(`cannot load runtime catalog: ${error instanceof Error ? error.message : String(error)}`)
      })
      .finally(() => {
        this.catalogLoading = false
      })
  }

  private handleSubmit(text: string): void {
    const parsed = parseCommandLine(text)
    if (parsed === undefined) {
      void this.bridge.send(text).catch((error: unknown) => {
        this.store.applyMany([{ kind: 'error', text: `send failed: ${error instanceof Error ? error.message : String(error)}` }])
      })
      return
    }
    const commands = mergeCommands(LOCAL_COMMANDS, PROMPT_COMMANDS, this.runtimeCommands, this.runtimeSkills)
    const command = parsed.name === 'exit'
      ? LOCAL_COMMANDS.find((candidate) => candidate.name === 'quit')
      : commands.find((candidate) => candidate.name === parsed.name)
    if (command === undefined) {
      this.note(`unknown command: /${parsed.name} — type / to browse commands`)
      return
    }
    if (command.source === 'runtime') {
      void this.bridge.executeCommand(text)
        .then((execution) => {
          if (!execution.matched) this.note(`runtime command disappeared: /${parsed.name}`)
          this.refreshRuntimeCatalog()
        })
        .catch((error: unknown) => this.note(`/${parsed.name} failed: ${error instanceof Error ? error.message : String(error)}`))
      return
    }
    if (command.source === 'skill') {
      void this.bridge.send(text).catch((error: unknown) => this.note(`/${parsed.name} failed: ${error instanceof Error ? error.message : String(error)}`))
      return
    }
    this.handleCommand(parsed.name, parsed.rawInput)
  }

  private handleCommand(command: string, rawInput: string): void {
    const rest = rawInput.trim().split(/\s+/).filter(Boolean)
    switch (command) {
      case 'quit':
      case 'exit':
        this.quit()
        return
      case 'new': {
        const id = rest[0]
        const sessionId = this.bridge.newSession(id)
        this.store.resetSession(sessionId)
        this.runtimeCommands = []
        this.runtimeSkills = []
        this.catalogReady = false
        this.catalogSessionId = undefined
        this.refreshRuntimeCatalog()
        this.note(id === undefined ? `started session ${sessionId}` : `switched to session ${id}`)
        return
      }
      case 'resume': {
        const id = rest[0]
        if (id === undefined) this.openSessionPicker()
        else this.resumeSession(id)
        return
      }
      case 'sessions':
        this.openSessionPicker()
        return
      case 'clear':
        this.store.clearView()
        this.note('new transcript batch · current session retained (older output remains in terminal scrollback)')
        return
      case 'status': {
        const state = this.store.getState()
        this.note(`${state.phase} · ${state.provider}/${state.model} · session ${state.sessionId ?? 'none'} · ${state.workspace}`)
        return
      }
      case 'session':
        this.note(`session: ${this.store.getState().sessionId ?? 'none'}`)
        return
      case 'model': {
        const requested = rest[0]
        if (requested === undefined) {
          this.openModelPicker('models')
          return
        }
        const separator = requested.indexOf('/')
        if (separator <= 0 || separator === requested.length - 1) {
          this.note('usage: /model or /model <provider>/<model>')
          return
        }
        this.selectModel(requested.slice(0, separator), requested.slice(separator + 1))
        return
      }
      case 'provider':
        this.openModelPicker('providers')
        return
      case 'init':
        void this.bridge.send('Inspect this repository and create or update its concise agent instructions file with verified build, test, and project conventions.')
          .catch((error: unknown) => this.note(`init failed: ${error instanceof Error ? error.message : String(error)}`))
        return
      case 'review': {
        const scope = rawInput.trim() || 'the current uncommitted changes'
        void this.bridge.send(`Review ${scope}. Focus on correctness, regressions, security, and missing tests. Report findings by severity before suggesting fixes.`)
          .catch((error: unknown) => this.note(`review failed: ${error instanceof Error ? error.message : String(error)}`))
        return
      }
      case 'help':
        this.note(KEY_HELP)
        return
      default:
        this.note(`unknown command: /${command} — type / to browse commands`)
    }
  }

  private note(text: string): void {
    this.store.applyMany([{ kind: 'note', text }])
  }

  private openSessionPicker(): void {
    const state = this.store.getState()
    if (state.phase === 'running' || state.phase === 'starting') {
      this.note('interrupt the current turn with Esc before browsing sessions')
      return
    }
    const component = new SessionPickerComponent({
      onSelect: (session) => this.resumeSession(session.id),
      onCancel: () => this.closeOverlay(),
    })
    component.setLoading()
    this.sessionPicker = component
    this.tui.showOverlay(component, {
      width: '90%',
      maxHeight: '80%',
      anchor: 'center',
    })
    void listSessions(this.sessionRoot, state.workspace, 8)
      .then((sessions) => {
        if (this.sessionPicker !== component) return
        component.setSessions(sessions)
        this.tui.requestRender()
      })
      .catch((error: unknown) => {
        if (this.sessionPicker !== component) return
        component.setError(error instanceof Error ? error.message : String(error))
        this.tui.requestRender()
      })
  }

  private resumeSession(id: string): void {
    const state = this.store.getState()
    if (state.phase === 'running' || state.phase === 'starting') {
      this.note('interrupt the current turn with Esc before resuming another session')
      return
    }
    void loadSession(this.sessionRoot, id)
      .then((session) => {
        if (session === undefined) {
          this.note(`session not found: ${id}`)
          return
        }
        this.closeOverlay()
        this.bridge.newSession(session.id)
        this.store.restoreSession(session.id, session.events.flatMap(classifySessionEvent))
        this.runtimeCommands = []
        this.runtimeSkills = []
        this.catalogReady = false
        this.catalogSessionId = undefined
        this.refreshRuntimeCatalog()
        this.note(`resumed ${session.title ?? session.id} · ${session.workspace}`)
      })
      .catch((error: unknown) => this.note(`cannot resume ${id}: ${error instanceof Error ? error.message : String(error)}`))
  }

  private openModelPicker(initialView: 'models' | 'providers'): void {
    const state = this.store.getState()
    const component = new ModelPickerComponent(
      initialView,
      [],
      [],
      { provider: state.provider, model: state.model },
      {
        onSelect: (provider, model) => this.selectModel(provider, model),
        onSaveProvider: (input) => this.saveProvider(input),
        onTestProvider: (input) => this.testProvider(input),
        onDeleteProvider: (provider) => this.deleteProvider(provider),
        onCancel: () => this.closeOverlay(),
      },
    )
    component.setLoading()
    this.modelPicker = component
    this.tui.showOverlay(component, { width: '92%', maxHeight: '88%', anchor: 'center' })
    void Promise.all([this.bridge.listModels(), this.bridge.listProviders()])
      .then(([models, providers]) => {
        if (this.modelPicker !== component) return
        component.setCatalog(models.groups, providers, models.current)
        this.tui.requestRender()
      })
      .catch((error: unknown) => {
        if (this.modelPicker !== component) return
        component.setError(error instanceof Error ? error.message : String(error))
        this.tui.requestRender()
      })
  }

  private selectModel(provider: string, model: string): void {
    this.modelPicker?.setBusy(true)
    void this.bridge.selectModel(provider, model)
      .then((selected) => {
        this.store.applyMany([{ kind: 'context', provider: selected.provider, model: selected.model }])
        this.closeOverlay()
        this.note(`model switched · ${selected.provider}/${selected.model}`)
      })
      .catch((error: unknown) => {
        this.modelPicker?.setError(error instanceof Error ? error.message : String(error))
        this.tui.requestRender()
      })
  }

  private saveProvider(input: SaveProviderInput): void {
    this.modelPicker?.setBusy(true)
    void this.bridge.saveProvider(input)
      .then(async ({ selected }) => {
        if (selected !== undefined) {
          this.store.applyMany([{ kind: 'context', provider: selected.provider, model: selected.model }])
          this.closeOverlay()
          this.note(`provider configured · ${selected.provider}/${selected.model}`)
          return
        }
        const [models, providers] = await Promise.all([this.bridge.listModels(), this.bridge.listProviders()])
        this.modelPicker?.setCatalog(models.groups, providers, models.current)
        this.modelPicker?.setBusy(false)
        this.note(`provider saved · ${input.provider}`)
        this.tui.requestRender()
      })
      .catch((error: unknown) => {
        this.modelPicker?.setError(error instanceof Error ? error.message : String(error))
        this.tui.requestRender()
      })
  }

  private deleteProvider(provider: string): void {
    this.modelPicker?.setBusy(true)
    void this.bridge.deleteProvider(provider)
      .then(async () => {
        const [models, providers] = await Promise.all([this.bridge.listModels(), this.bridge.listProviders()])
        this.modelPicker?.setCatalog(models.groups, providers, models.current)
        this.modelPicker?.setBusy(false)
        this.note(`provider deleted · ${provider}`)
        this.tui.requestRender()
      })
      .catch((error: unknown) => {
        this.modelPicker?.setError(error instanceof Error ? error.message : String(error))
        this.tui.requestRender()
      })
  }

  private testProvider(input: Omit<SaveProviderInput, 'model' | 'select'>): void {
    this.modelPicker?.setBusy(true)
    void this.bridge.testProvider(input)
      .then((models) => {
        this.modelPicker?.setBusy(false)
        this.modelPicker?.setError(models.length === 0
          ? 'Connection succeeded, but the provider returned no models.'
          : `Connection succeeded · ${models.slice(0, 5).map((model) => model.id).join(', ')}${models.length > 5 ? ` · +${models.length - 5} more` : ''}`)
        this.tui.requestRender()
      })
      .catch((error: unknown) => {
        this.modelPicker?.setError(error instanceof Error ? error.message : String(error))
        this.tui.requestRender()
      })
  }

  private closeOverlay(): void {
    if (this.tui.hasOverlay()) this.tui.hideOverlay()
    this.sessionPicker = undefined
    this.modelPicker = undefined
    this.tui.setFocus(this.editor)
    this.tui.requestRender()
  }

  handleInput(data: string): TuiInputListenerResult {
    if (this.tui.hasOverlay()) return undefined
    if (data === '\u0003' || matchesKey(data, 'ctrl+c')) {
      this.quit()
      return { consume: true }
    }
    const isEscape = data === '\u001b' || matchesKey(data, 'escape')
    const phase = this.store.getState().phase
    if (isEscape && (phase === 'running' || this.interruptState.active)) {
      if (phase === 'running' && !this.interruptState.active) {
        this.interruptState.active = true
        this.store.beginInterrupt()
        void this.bridge.interrupt()
          .then(() => this.store.applyMany([
            { kind: 'phase', status: 'idle' },
            { kind: 'note', text: 'turn interrupted · ready for the next message' },
          ]))
          .catch((error: unknown) => this.note(`interrupt failed: ${error instanceof Error ? error.message : String(error)}`))
          .finally(() => {
            this.interruptState.active = false
          })
      }
      return { consume: true }
    }
    return undefined
  }
}

export function mountApp(
  store: Store,
  bridge: AstraBridge,
  quit: () => void,
  sessionRoot: string,
  terminal?: Terminal,
): AstraApp {
  const app = new AstraApp({ store, bridge, quit, sessionRoot, terminal })
  app.start()
  return app
}
