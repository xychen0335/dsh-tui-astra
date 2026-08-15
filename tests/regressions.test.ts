import assert from 'node:assert/strict'
import test from 'node:test'
import { homedir } from 'node:os'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { zstdCompressSync } from 'node:zlib'
import { visibleWidth } from '@earendil-works/pi-tui'
import type { HarnessNotification } from '@deepseek-ai/dsh-sdk-client'
import { parseArgs } from '../src/config.ts'
import { customProviderConfig } from '../src/runtime-provider.ts'
import { NotificationClassifier, classifySessionEvent } from '../src/harness/events.ts'
import { Store } from '../src/store.ts'
import { listSessions, loadSession, projectKey, scanZstdFrames } from '../src/sessions.ts'
import { activityRows } from '../src/ui/activity.ts'
import { chatRows, wrapRows } from '../src/ui/chat.ts'
import {
  LOCAL_COMMANDS,
  mergeCommands,
  matchingCommands,
  parseCommandLine,
} from '../src/ui/commands.ts'
import { nextGraphemeBoundary, previousGraphemeBoundary } from '../src/ui/input.ts'
import { relativeTime, shortSessionId } from '../src/ui/session-picker.ts'
import { SessionPickerComponent } from '../src/ui/session-picker.ts'
import { isMouseReport } from '../src/ui/terminal-input.ts'
import { AstraApp } from '../src/ui/app.ts'
import type { AstraBridge } from '../src/ui/app.ts'
import { FakeTerminal } from './fake-terminal.ts'
import {
  configureRuntimeProvider,
  createOrResumeRuntimeSession,
  deleteRuntimeProvider,
  executeRuntimeCommand,
  listRuntimeProviders,
  listRuntimeCommands,
  listRuntimeModels,
  listRuntimeSkills,
  saveRuntimeProvider,
  selectRuntimeModel,
  testRuntimeProvider,
} from '../src/runtime-server.ts'
import { matchesModelQuery, ModelPickerComponent, providerForm } from '../src/ui/model-picker.ts'

function notification(method: string, params: Record<string, unknown>): HarnessNotification {
  return { method, params } as HarnessNotification
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

test('DSH_CWD supplies the default workspace', () => {
  const previous = process.env['DSH_CWD']
  process.env['DSH_CWD'] = '/tmp/dsh-workspace'
  try {
    assert.equal(parseArgs([]).workspace, '/tmp/dsh-workspace')
    assert.equal(parseArgs(['--cwd', '/tmp/cli-workspace']).workspace, '/tmp/cli-workspace')
  } finally {
    if (previous === undefined) delete process.env['DSH_CWD']
    else process.env['DSH_CWD'] = previous
  }
})

test('provider configuration follows CLI over environment without exposing literal credentials', () => {
  const previous = {
    provider: process.env['DSH_PROVIDER'],
    model: process.env['DSH_MODEL'],
    baseURL: process.env['DSH_BASE_URL'],
    apiKeyEnv: process.env['DSH_API_KEY_ENV'],
    apiKey: process.env['DSH_API_KEY'],
  }
  process.env['DSH_PROVIDER'] = 'environment-route'
  process.env['DSH_MODEL'] = 'environment-model'
  process.env['DSH_BASE_URL'] = 'https://environment.example/v1'
  process.env['DSH_API_KEY_ENV'] = 'ENVIRONMENT_API_KEY'
  process.env['DSH_API_KEY'] = 'literal-secret-must-not-enter-config'
  try {
    const options = parseArgs([
      '--provider', 'cli-route',
      '--model', 'cli-model',
      '--base-url', 'https://cli.example/v1',
      '--api-key-env', 'CLI_API_KEY',
      '--api', 'openai-completions',
    ])
    assert.equal(options.provider, 'cli-route')
    assert.equal(options.model, 'cli-model')
    assert.equal(options.baseURL, 'https://cli.example/v1')
    assert.equal(options.apiKeyEnv, 'CLI_API_KEY')
    assert.equal(options.api, 'openai-completions')

    const config = customProviderConfig({
      DSH_PROVIDER: options.provider,
      DSH_MODEL: options.model,
      DSH_BASE_URL: options.baseURL,
      DSH_API_KEY_ENV: options.apiKeyEnv,
      DSH_API: options.api,
      DSH_API_KEY: process.env['DSH_API_KEY'],
    })
    assert.deepEqual(config, {
      providers: {
        'cli-route': {
          apiKeyEnv: 'CLI_API_KEY',
          api: 'openai-completions',
          baseURL: 'https://cli.example/v1',
          models: [{ id: 'cli-model' }],
        },
      },
    })
    assert.equal(JSON.stringify(config).includes('literal-secret-must-not-enter-config'), false)
  } finally {
    restoreEnv('DSH_PROVIDER', previous.provider)
    restoreEnv('DSH_MODEL', previous.model)
    restoreEnv('DSH_BASE_URL', previous.baseURL)
    restoreEnv('DSH_API_KEY_ENV', previous.apiKeyEnv)
    restoreEnv('DSH_API_KEY', previous.apiKey)
  }
})

test('non-DeepSeek providers require an explicit model', () => {
  const previousProvider = process.env['DSH_PROVIDER']
  const previousModel = process.env['DSH_MODEL']
  process.env['DSH_PROVIDER'] = 'custom-route'
  delete process.env['DSH_MODEL']
  try {
    assert.throws(() => parseArgs([]), /requires --model or DSH_MODEL/)
  } finally {
    restoreEnv('DSH_PROVIDER', previousProvider)
    restoreEnv('DSH_MODEL', previousModel)
  }
})

test('changing only the provider does not inherit the DeepSeek default model', () => {
  const previousProvider = process.env['DSH_PROVIDER']
  const previousModel = process.env['DSH_MODEL']
  delete process.env['DSH_PROVIDER']
  delete process.env['DSH_MODEL']
  try {
    assert.throws(() => parseArgs(['--provider', 'openai']), /requires --model or DSH_MODEL/)
    assert.equal(parseArgs([]).model, 'deepseek-v4-flash')
  } finally {
    restoreEnv('DSH_PROVIDER', previousProvider)
    restoreEnv('DSH_MODEL', previousModel)
  }
})

test('DSH_API is referenced by name and never copied into provider configuration', () => {
  const config = customProviderConfig({
    DSH_PROVIDER: 'private-gateway',
    DSH_MODEL: 'private-model',
    DSH_BASE_URL: 'https://gateway.example/v1',
    DSH_API: 'openai-completions',
    DSH_API_KEY: 'top-secret',
  })
  assert.equal(config.providers?.['private-gateway']?.apiKeyEnv, 'DSH_API_KEY')
  assert.equal(JSON.stringify(config).includes('top-secret'), false)
})

test('sessions default to the native Harness home without a hard-coded user path', () => {
  const previousRoot = process.env['DSH_SESSION_ROOT']
  const previousHome = process.env['DSH_HOME']
  delete process.env['DSH_SESSION_ROOT']
  delete process.env['DSH_HOME']
  try {
    assert.equal(parseArgs([]).sessionRoot, join(homedir(), '.dsh', 'sessions'))
    process.env['DSH_HOME'] = '/tmp/custom-dsh-home'
    assert.equal(parseArgs([]).sessionRoot, '/tmp/custom-dsh-home/sessions')
    process.env['DSH_SESSION_ROOT'] = '/tmp/explicit-session-root'
    assert.equal(parseArgs([]).sessionRoot, '/tmp/explicit-session-root')
  } finally {
    if (previousRoot === undefined) delete process.env['DSH_SESSION_ROOT']
    else process.env['DSH_SESSION_ROOT'] = previousRoot
    if (previousHome === undefined) delete process.env['DSH_HOME']
    else process.env['DSH_HOME'] = previousHome
  }
})

test('notification classifier follows only the active session tree', () => {
  const classifier = new NotificationClassifier()
  const unrelated = notification('subagent.started', {
    parentSessionId: 'other',
    childSessionId: 'other-child',
  })
  assert.deepEqual(classifier.classify(unrelated, 'root'), [])

  const child = notification('subagent.started', {
    parentSessionId: 'root',
    childSessionId: 'child',
  })
  assert.deepEqual(classifier.classify(child, 'root'), [
    { kind: 'subagent', id: 'child', status: 'started' },
  ])

  const grandchild = notification('subagent.started', {
    parentSessionId: 'child',
    childSessionId: 'grandchild',
  })
  assert.equal(classifier.classify(grandchild, 'root').length, 1)
  assert.deepEqual(classifier.classify(grandchild, 'new-root'), [])
})

test('terminal turn failures surface the provider error', () => {
  const classifier = new NotificationClassifier()
  const failedTurn = notification('session.event', {
    sessionId: 'root',
    event: {
      type: 'turn/end',
      data: {
        turn: 1,
        reason: {
          kind: 'error',
          error: { message: 'missing credential', code: 'MISSING_CREDENTIAL' },
        },
      },
    },
  })
  assert.deepEqual(classifier.classify(failedTurn, 'root'), [
    { kind: 'turn', text: 'turn 1 ended (error)' },
    { kind: 'error', text: 'missing credential (MISSING_CREDENTIAL)' },
  ])
})

test('command lifecycle events stay in the activity plane', () => {
  const store = new Store({ provider: 'provider', model: 'model', workspace: '/tmp' })
  store.applyMany(classifySessionEvent({
    type: 'command/run',
    seq: 1,
    time: 1,
    data: {
      commandId: 'command-1',
      name: 'compact',
      source: { kind: 'user' },
    },
  }))
  store.applyMany(classifySessionEvent({
    type: 'command/done',
    seq: 2,
    time: 2,
    data: {
      commandId: 'command-1',
      kind: 'success',
      text: 'No compactable history yet.',
    },
  }))

  assert.deepEqual(store.getState().activities.map(({ kind, text, error }) => ({ kind, text, error })), [
    { kind: 'command', text: '/compact', error: false },
    { kind: 'command', text: 'compact → No compactable history yet.', error: false },
  ])
  assert.equal(store.getState().messages.length, 0)
})

test('user-invoked skill context is presented as a terse activity', () => {
  assert.deepEqual(classifySessionEvent({
    type: 'user/message',
    seq: 1,
    time: 1,
    data: {
      id: 'skill-context',
      role: 'user',
      content: [{ type: 'text', text: '<skill_content name="code-review">large body</skill_content>' }],
      source: { kind: 'skill-invocation', name: 'code-review', form: 'instructions' },
    },
  }), [{ kind: 'note', text: 'skill: code-review' }])
})

test('store resets session state and tracks active subagents', () => {
  const store = new Store({ provider: 'provider', model: 'model', workspace: '/tmp' })
  store.setSessionId('old')
  store.applyMany([
    { kind: 'subagent', id: 'child', status: 'started' },
    { kind: 'error', text: 'old failure' },
  ])
  assert.equal(store.getState().activeSubagents, 1)

  store.resetSession('new')
  assert.equal(store.getState().sessionId, 'new')
  assert.equal(store.getState().activeSubagents, 0)

  store.applyMany([{ kind: 'user-message', id: 'visible', text: 'clear me', injected: false }])
  store.applyMany([{
    kind: 'todos',
    todos: [{ content: 'keep the active task', status: 'in_progress' }],
  }])
  store.clearView()
  assert.equal(store.getState().sessionId, 'new')
  assert.equal(store.getState().messages.length, 0)
  assert.equal(store.getState().activities.length, 0)
  assert.deepEqual(store.getState().todos, [{ content: 'keep the active task', status: 'in_progress' }])
  assert.equal(store.getState().error, null)

  store.applyMany([
    { kind: 'subagent', id: 'child', status: 'started' },
    { kind: 'subagent', id: 'child', status: 'finished', ok: true },
  ])
  assert.equal(store.getState().activeSubagents, 0)
})

test('slash command catalog merges runtime entries without overriding local commands', () => {
  const commands = mergeCommands(LOCAL_COMMANDS, [
    { name: 'compact', description: 'compact history', source: 'runtime' },
    { name: 'clear', description: 'runtime clear', source: 'runtime' },
  ])
  assert.equal(commands.find((command) => command.name === 'clear')?.source, 'local')
  assert.equal(commands.find((command) => command.name === 'compact')?.source, 'runtime')
  assert.equal(commands.find((command) => command.name === 'model')?.description, 'search and switch the session model')
  assert.equal(commands.find((command) => command.name === 'provider')?.description, 'add, edit, test, or delete model providers')
})

test('slash command discovery filters commands without swallowing arguments', () => {
  const commands = mergeCommands(LOCAL_COMMANDS, [
    { name: 'compact', description: 'compact history', source: 'runtime' },
  ])
  assert.equal(matchingCommands('/res', commands)[0]?.name, 'resume')
  assert.equal(matchingCommands('/', commands).length, 6)
  assert.deepEqual(matchingCommands('/resume session-id', commands), [])
})

test('slash command parsing preserves the runtime command raw input', () => {
  assert.deepEqual(parseCommandLine('/feedback   exact  text'), {
    name: 'feedback',
    rawInput: '   exact  text',
  })
  assert.equal(parseCommandLine('/not.valid'), undefined)
  assert.equal(parseCommandLine('ordinary text'), undefined)
})

test('workspace session directory matches Harness persistence naming', () => {
  assert.equal(projectKey('/Users/xychen/project'), '--Users-xychen-project--')
  assert.equal(projectKey('C:\\Code\\项目'), '--C-Code-~9879~76EE--')
})

test('session discovery spans projects and resume decodes concatenated zstd frames', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-tui-sessions-'))
  try {
    const workspace = '/tmp/another-project'
    const id = 'session-persisted'
    const directory = join(root, projectKey(workspace), id)
    await mkdir(directory, { recursive: true })
    const header = `${JSON.stringify({ type: 'session', version: 0, id, cwd: workspace, createdAt: 1, delegationDepth: 0 })}\n`
    const userEvent = {
      type: 'user/message',
      seq: 0,
      time: 2,
      data: {
        content: [{ type: 'text', text: 'saved hello' }],
        source: { kind: 'user' },
        role: 'user',
        id: 'message-1',
      },
    }
    const titleEvent = {
      type: 'session/title',
      seq: 1,
      time: 3,
      data: { title: 'Saved conversation' },
    }
    const eventFrame = `${JSON.stringify(userEvent)}\n${JSON.stringify(titleEvent)}\n`
    const compressed = Buffer.concat([zstdCompressSync(header), zstdCompressSync(eventFrame)])
    await writeFile(join(directory, 'session.jsonl.zstd'), compressed)

    assert.equal(scanZstdFrames(compressed).length, 2)
    const listed = await listSessions(root, '/tmp/current-project')
    assert.deepEqual(listed.map(({ id: listedId, workspace: listedWorkspace }) => [listedId, listedWorkspace]), [
      [id, workspace],
    ])
    assert.equal(listed[0]?.title, 'Saved conversation')
    const loaded = await loadSession(root, id)
    assert.equal(loaded?.events.length, 2)
    assert.equal(loaded?.title, 'Saved conversation')
    assert.deepEqual(loaded?.events.flatMap(classifySessionEvent), [
      { kind: 'user-message', id: 'message-1', text: 'saved hello', injected: false },
    ])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('session picker metadata stays compact and readable', () => {
  assert.equal(shortSessionId('session-1234567890abcdefghijklmnop'), 'session-12345678…klmnop')
  assert.equal(relativeTime(1_000, 46_000), 'just now')
  assert.equal(relativeTime(1_000, 181_000), '3m ago')
})

test('restoring a session replays messages and leaves it ready for another turn', () => {
  const store = new Store({ provider: 'provider', model: 'model', workspace: '/tmp' })
  store.restoreSession('saved', [
    { kind: 'user-message', id: 'user-1', text: 'old prompt', injected: false },
    { kind: 'assistant-text', text: 'partial answer' },
    { kind: 'error', text: 'old interruption' },
  ])
  assert.equal(store.getState().sessionId, 'saved')
  assert.equal(store.getState().phase, 'idle')
  assert.equal(store.getState().error, null)
  assert.equal(store.getState().messages[1]?.streaming, false)
})

test('replacement runtime resumes a persisted id instead of creating a collision', async () => {
  const calls: string[] = []
  const handle = { agent: { id: 'saved', followup: () => {} }, dispose: async () => {} }
  const server = {
    cwd: '/tmp/project',
    provider: 'provider',
    model: 'model',
    sessions: new Map(),
    ctx: {
      sessionPersistence: { list: async () => [{ id: 'saved' }] },
      agents: {
        create: async () => { calls.push('create'); return handle },
        resume: async () => { calls.push('resume'); return handle },
      },
    },
  }
  await createOrResumeRuntimeSession(server, 'saved')
  assert.deepEqual(calls, ['resume'])
  assert.equal(server.sessions.get('saved')?.handle, handle)
})

test('runtime command helpers use the exact session agent and preserve direct results', async () => {
  const agent = { id: 'session-command' }
  const lines: string[] = []
  const server = {
    sessions: new Map([
      ['session-command', { handle: { agent } }],
    ]),
    ctx: {
      commands: {
        list: (received: unknown) => {
          assert.equal(received, agent)
          return [{ name: 'compact', description: 'Compact history' }]
        },
        execute: async (received: unknown, line: string) => {
          assert.equal(received, agent)
          lines.push(line)
          return {
            commandId: 'command-1',
            result: { kind: 'success' as const, text: 'done' },
          }
        },
      },
    },
  }

  assert.deepEqual(await listRuntimeCommands(server, 'session-command'), {
    commands: [{ name: 'compact', description: 'Compact history' }],
  })
  assert.deepEqual(await executeRuntimeCommand(server, 'session-command', '/compact'), {
    matched: true,
    commandId: 'command-1',
    result: { kind: 'success', text: 'done' },
  })
  assert.deepEqual(lines, ['/compact'])
})

test('runtime command descriptors preserve input hints for goal and plan commands', async () => {
  const agent = { id: 'session-command-hints' }
  const server = {
    sessions: new Map([
      ['session-command-hints', { handle: { agent } }],
    ]),
    ctx: {
      commands: {
        list: () => [
          {
            name: 'goal',
            description: 'set or view the goal for a long-running task',
            input: { hint: '[<objective>|clear|edit <objective>|pause|resume]' },
          },
          {
            name: 'plan',
            description: 'Enter or leave plan mode',
            input: { hint: '[off|message]' },
          },
        ],
      },
    },
  }

  assert.deepEqual(await listRuntimeCommands(server, 'session-command-hints'), {
    commands: [
      {
        name: 'goal',
        description: 'set or view the goal for a long-running task',
        input: { hint: '[<objective>|clear|edit <objective>|pause|resume]' },
      },
      {
        name: 'plan',
        description: 'Enter or leave plan mode',
        input: { hint: '[off|message]' },
      },
    ],
  })
})

test('runtime skill discovery returns only user-invocable summaries for the session workspace', async () => {
  const agent = { id: 'session-skills', session: { header: { cwd: '/tmp/project' } } }
  const lookups: unknown[] = []
  const server = {
    sessions: new Map([
      ['session-skills', { handle: { agent } }],
    ]),
    ctx: {
      skills: {
        list: async (lookup: unknown) => {
          lookups.push(lookup)
          return [
            {
              name: 'code-review',
              description: 'Review code changes',
              invocation: { modelInvocable: true, userInvocable: true },
              source: 'user-agents',
              provider: 'local',
            },
            {
              name: 'model-only',
              description: 'Hidden from users',
              invocation: { modelInvocable: true, userInvocable: false },
              source: 'runtime',
              provider: 'runtime',
            },
          ]
        },
      },
    },
  }

  assert.deepEqual(await listRuntimeSkills(server, 'session-skills'), {
    skills: [{
      name: 'code-review',
      description: 'Review code changes',
      modelInvocable: true,
      source: 'user-agents',
    }],
  })
  assert.equal((lookups[0] as { cwd?: string }).cwd, '/tmp/project')
  assert.equal((lookups[0] as { scope?: unknown }).scope, agent)
})

test('runtime model selection changes the next-step route without replacing the agent', async () => {
  const listeners: Array<(payload: unknown, next: () => Promise<unknown>) => Promise<unknown>> = []
  const agent = {
    id: 'session-models',
    options: { provider: 'provider-a', model: 'model-a' },
    session: {
      requestHeader: () => undefined,
      header: { cwd: '/tmp/project' },
    },
    ctx: {
      on: (_event: string, listener: (payload: unknown, next: () => Promise<unknown>) => Promise<unknown>) => {
        listeners.push(listener)
        return () => {}
      },
    },
  }
  const server = {
    sessions: new Map([['session-models', { handle: { agent } }]]),
    ctx: {
      llm: {
        listProviders: () => [
          { id: 'provider-a', name: 'Provider A' },
          { id: 'provider-b', name: 'Provider B' },
        ],
        listModels: async (provider: string) => provider === 'provider-a'
          ? [{ provider, id: 'model-a', name: 'Model A' }]
          : [{ provider, id: 'model-b', name: 'Model B' }],
        resolveCallConfig: async ({ provider, model }: { provider: string; model: string }) => ({ provider, model }),
      },
    },
  }

  assert.deepEqual(await listRuntimeModels(server, 'session-models'), {
    current: { provider: 'provider-a', model: 'model-a' },
    groups: [
      { id: 'provider-a', name: 'Provider A', models: [{ id: 'model-a', name: 'Model A' }] },
      { id: 'provider-b', name: 'Provider B', models: [{ id: 'model-b', name: 'Model B' }] },
    ],
    failures: [],
  })
  assert.deepEqual(await selectRuntimeModel(server, 'session-models', 'provider-b', 'model-b'), {
    selected: { provider: 'provider-b', model: 'model-b' },
  })
  assert.equal(server.sessions.get('session-models')?.handle.agent, agent)
  assert.deepEqual((await listRuntimeModels(server, 'session-models')).current, {
    provider: 'provider-b',
    model: 'model-b',
  })
  assert.equal(listeners.length, 2)
})

test('interactive provider configuration stores secrets through the credential seam', async () => {
  const credentials: Array<[string, string]> = []
  const mutations: unknown[] = []
  const agent = {
    id: 'session-provider-config',
    options: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    session: { requestHeader: () => undefined, header: { cwd: '/tmp/project' } },
    ctx: { on: () => () => {} },
  }
  const server = {
    sessions: new Map([['session-provider-config', { handle: { agent } }]]),
    ctx: {
      credentials: {
        set: async (ref: string, value: string) => { credentials.push([String(ref), value]) },
      },
      settings: {
        mutate: async (namespace: string, operations: unknown[]) => {
          mutations.push({ namespace: String(namespace), operations })
        },
      },
      llm: {
        resolveCallConfig: async ({ provider, model }: { provider: string; model: string }) => ({ provider, model }),
      },
    },
  }

  assert.deepEqual(await configureRuntimeProvider(server, {
    sessionId: 'session-provider-config',
    provider: 'company',
    model: 'company-large',
    baseURL: 'https://llm.company.example/v1',
    api: 'openai-completions',
    apiKey: 'secret-value',
  }), {
    selected: { provider: 'company', model: 'company-large' },
  })
  assert.deepEqual(credentials, [['DSH_PROVIDER_COMPANY_API_KEY', 'secret-value']])
  assert.equal(JSON.stringify(mutations).includes('secret-value'), false)
  assert.match(JSON.stringify(mutations), /llm-pi-ai/)
})

test('provider management returns editable metadata without returning secret values', async () => {
  const server = {
    ctx: {
      llm: {
        listProviders: () => [{ id: 'company', name: 'Company LLM' }],
        listConfigurableProviders: () => [{
          provider: 'company',
          displayName: 'Company LLM',
          settingsNs: 'llm-pi-ai',
          settingsPath: ['providers', 'company'],
          declared: true,
        }],
      },
      settings: {
        describe: () => [{
          ns: 'llm-pi-ai',
          user: {
            providers: {
              company: {
                apiKeyEnv: 'DSH_PROVIDER_COMPANY_API_KEY',
                baseURL: 'https://llm.company.example/v1',
                api: 'openai-completions',
                models: [{ id: 'company-large' }],
              },
            },
          },
        }],
      },
      credentials: {
        describe: async () => ({
          configured: true,
          source: 'file',
          writable: true,
        }),
      },
    },
  }

  assert.deepEqual(await listRuntimeProviders(server), {
    providers: [{
      id: 'company',
      name: 'Company LLM',
      active: true,
      configured: true,
      builtIn: false,
      declared: true,
      baseURL: 'https://llm.company.example/v1',
      api: 'openai-completions',
      model: 'company-large',
      credentialRef: 'DSH_PROVIDER_COMPANY_API_KEY',
      credentialConfigured: true,
      credentialSource: 'file',
      credentialWritable: true,
    }],
  })
  assert.equal(JSON.stringify(await listRuntimeProviders(server)).includes('secret'), false)
})

test('provider management edits existing profiles and deletes managed credentials', async () => {
  const operations: unknown[] = []
  const credentials: string[] = []
  const agent = {
    id: 'session-provider-management',
    options: { provider: 'deepseek-official', model: 'deepseek-v4-flash' },
    session: { requestHeader: () => undefined, header: { cwd: '/tmp/project' } },
    ctx: { on: () => () => {} },
  }
  const settings = {
    describe: () => [{
      ns: 'llm-pi-ai',
      user: {
        providers: {
          company: {
            apiKeyEnv: 'DSH_PROVIDER_COMPANY_API_KEY',
            baseURL: 'https://old.example/v1',
            api: 'openai-completions',
            models: [{ id: 'old-model' }],
          },
        },
      },
    }],
    mutate: async (_namespace: string, ops: unknown[]) => { operations.push(...ops) },
  }
  const server = {
    sessions: new Map([['session-provider-management', { handle: { agent } }]]),
    ctx: {
      settings,
      credentials: {
        set: async (ref: string) => { credentials.push(`set:${String(ref)}`) },
        describe: async () => ({ configured: true, source: 'file', writable: true }),
        unset: async (ref: string) => { credentials.push(`unset:${String(ref)}`) },
      },
      llm: {
        resolveCallConfig: async ({ provider, model }: { provider: string; model: string }) => ({ provider, model }),
      },
    },
  }

  assert.deepEqual(await saveRuntimeProvider(server, {
    sessionId: 'session-provider-management',
    provider: 'company',
    model: 'new-model',
    baseURL: 'https://new.example/v1',
    api: 'openai-responses',
    apiKey: 'new-secret',
    select: true,
  }), {
    selected: { provider: 'company', model: 'new-model' },
  })
  assert.deepEqual(credentials, ['set:DSH_PROVIDER_COMPANY_API_KEY'])
  assert.equal(JSON.stringify(operations).includes('new-secret'), false)
  assert.match(JSON.stringify(operations), /new-model/)

  assert.deepEqual(await deleteRuntimeProvider(server, 'company'), {})
  assert.deepEqual(credentials, [
    'set:DSH_PROVIDER_COMPANY_API_KEY',
    'unset:DSH_PROVIDER_COMPANY_API_KEY',
  ])
  assert.match(JSON.stringify(operations.at(-1)), /unset/)
})

test('provider connection testing reuses the stored credential without exposing it', async () => {
  const discoveries: unknown[] = []
  const server = {
    ctx: {
      settings: {
        describe: () => [{
          ns: 'llm-pi-ai',
          user: {
            providers: {
              company: {
                apiKeyEnv: 'DSH_PROVIDER_COMPANY_API_KEY',
                baseURL: 'https://company.example/v1',
                api: 'openai-responses',
              },
            },
          },
        }],
      },
      credentials: {
        resolve: async () => ({ value: 'stored-secret', source: 'file' }),
      },
      llm: {
        discoverModels: async (_namespace: string, request: unknown) => {
          discoveries.push(request)
          return [{ id: 'company-large', name: 'Company Large' }]
        },
      },
    },
  }

  assert.deepEqual(await testRuntimeProvider(server, { provider: 'company' }), {
    models: [{ id: 'company-large', name: 'Company Large' }],
  })
  assert.deepEqual(discoveries, [{
    provider: 'company',
    baseURL: 'https://company.example/v1',
    api: 'openai-responses',
    apiKey: 'stored-secret',
  }])
})

test('model picker pre-fills existing provider fields and searches provider/model text', () => {
  const form = providerForm({
    id: 'company',
    name: 'Company',
    active: true,
    configured: true,
    builtIn: false,
    baseURL: 'https://company.example/v1',
    api: 'openai-responses',
    model: 'company-large',
    credentialConfigured: true,
    credentialSource: 'file',
    credentialWritable: true,
  })
  assert.deepEqual(form, {
    provider: 'company',
    model: 'company-large',
    baseURL: 'https://company.example/v1',
    api: 'openai-responses',
    apiKey: '',
  })
  assert.equal(providerForm().api, 'openai-completions')
  assert.equal(matchesModelQuery({
    provider: 'company',
    providerName: 'Company',
    model: 'company-large',
    name: 'Company Large',
  }, 'company/large'), true)
  assert.equal(matchesModelQuery({
    provider: 'company',
    providerName: 'Company',
    model: 'company-large',
    name: 'Company Large',
  }, 'anthropic'), false)
})

test('cursor movement keeps Unicode graphemes intact', () => {
  const text = 'A👨‍👩‍👧‍👦éB'
  const afterA = nextGraphemeBoundary(text, 0)
  const afterEmoji = nextGraphemeBoundary(text, afterA)
  const afterAccent = nextGraphemeBoundary(text, afterEmoji)
  assert.equal(text.slice(afterA, afterEmoji), '👨‍👩‍👧‍👦')
  assert.equal(text.slice(afterEmoji, afterAccent), 'é')
  assert.equal(previousGraphemeBoundary(text, afterAccent), afterEmoji)
})

test('model forms reject terminal mouse reports instead of corrupting credentials', () => {
  assert.equal(isMouseReport('[<0;5;32M'), true)
  assert.equal(isMouseReport('[<64;80;24M'), true)
  assert.equal(isMouseReport('normal-api-key'), false)
})

test('conversation rows use the compact single-column visual language', () => {
  const store = new Store({ provider: 'provider', model: 'model', workspace: '/tmp' })
  store.applyMany([
    { kind: 'user-message', id: 'user-1', text: 'hello', injected: false },
    { kind: 'assistant-text', text: 'hi' },
  ])

  const rows = chatRows(store.getState())
  assert.equal(rows.find((row) => row.key === 'user-1/head')?.text, '› You')
  assert.equal(rows.find((row) => row.key === 'assistant-1/head')?.text, '• dsh')
  assert.equal(rows.find((row) => row.key === 'user-1/t0')?.text, '  hello')
})

test('conversation wrapping counts physical terminal rows and preserves graphemes', () => {
  const rows = wrapRows([
    { key: 'latin', text: 'abcdefghij' },
    { key: 'cjk', text: '中文测试' },
    { key: 'emoji', text: 'A👨‍👩‍👧‍👦B' },
  ], 5)

  assert.deepEqual(rows.filter((row) => row.key.startsWith('latin/')).map((row) => row.text), ['abcde', 'fghij'])
  assert.deepEqual(rows.filter((row) => row.key.startsWith('cjk/')).map((row) => row.text), ['中文', '测试'])
  assert.deepEqual(rows.filter((row) => row.key.startsWith('emoji/')).map((row) => row.text), ['A👨‍👩‍👧‍👦B'])
})

test('activity rows stay terse and reserve red for errors', () => {
  const rows = activityRows([
    { id: 1, time: 0, kind: 'tool', text: 'bash ls', error: false },
    { id: 2, time: 0, kind: 'error', text: 'failed', error: true },
  ])
  assert.deepEqual(rows.map(({ text, color }) => ({ text, color })), [
    { text: '• bash ls', color: 'gray' },
    { text: '× failed', color: 'red' },
  ])
})

function idleBridge(overrides: Partial<AstraBridge> = {}): AstraBridge {
  return {
    getSessionId: () => 'session-test',
    newSession: (id) => id ?? 'session-new',
    send: async () => 'message-test',
    executeCommand: async () => ({ matched: true }),
    listCommands: async () => [],
    listSkills: async () => [],
    interrupt: async () => {},
    listModels: async () => ({
      current: { provider: 'provider', model: 'model' },
      groups: [],
      failures: [],
    }),
    listProviders: async () => [],
    selectModel: async (provider, model) => ({ provider, model }),
    saveProvider: async () => ({}),
    deleteProvider: async () => {},
    testProvider: async () => [],
    ...overrides,
  }
}

async function settleTui(): Promise<void> {
  await new Promise<void>((resolve) => process.nextTick(resolve))
  await new Promise<void>((resolve) => setTimeout(resolve, 25))
}

test('pi-tui main screen has no mouse capture or alternate-screen sequences', async () => {
  const terminal = new FakeTerminal()
  const store = new Store({ provider: 'provider', model: 'model', workspace: '/tmp' })
  const app = new AstraApp({
    store,
    bridge: idleBridge(),
    quit: () => {},
    sessionRoot: '/tmp/no-sessions',
    terminal,
  })
  app.start()
  await settleTui()
  assert.equal(terminal.getOutput().includes('\u001b[?1000h'), false)
  assert.equal(terminal.getOutput().includes('\u001b[?1006h'), false)
  assert.equal(terminal.getOutput().includes('\u001b[?1049h'), false)
  app.stop()
})

test('pi-tui document keeps streaming in the dynamic tail and promotes completion', async () => {
  const terminal = new FakeTerminal(60, 20)
  const store = new Store({ provider: 'provider', model: 'model', workspace: '/tmp' })
  const app = new AstraApp({
    store,
    bridge: idleBridge(),
    quit: () => {},
    sessionRoot: '/tmp/no-sessions',
    terminal,
  })
  app.start()
  await settleTui()
  terminal.clearOutput()

  store.applyMany([{ kind: 'user-message', id: 'u1', text: 'prompt', injected: false }])
  store.applyMany([{ kind: 'assistant-text', text: 'partial' }])
  await settleTui()
  assert.match(terminal.getOutput(), /prompt/)
  assert.match(terminal.getOutput(), /partial/)

  terminal.clearOutput()
  store.applyMany([{ kind: 'assistant-text', text: ' answer' }])
  await settleTui()
  assert.match(terminal.getOutput(), /partial answer/)

  terminal.clearOutput()
  store.applyMany([{ kind: 'assistant-done' }])
  await settleTui()
  assert.match(terminal.getOutput(), /partial answer/)
  assert.equal(store.getState().messages.at(-1)?.streaming, false)

  terminal.clearOutput()
  store.applyMany([{ kind: 'note', text: 'activity only' }])
  await settleTui()
  assert.match(terminal.getOutput(), /activity only/)
  assert.doesNotMatch(terminal.getOutput(), /streaming, false\)/)
  app.stop()
})

test('pi-tui resize and clear rebuild the live document without losing routing', async () => {
  const terminal = new FakeTerminal(80, 24)
  let submitted = ''
  const store = new Store({ provider: 'provider', model: 'model', workspace: '/tmp' })
  const app = new AstraApp({
    store,
    bridge: idleBridge({ send: async (text) => { submitted = text; return 'message-test' } }),
    quit: () => {},
    sessionRoot: '/tmp/no-sessions',
    terminal,
  })
  app.start()
  await settleTui()
  terminal.sendInput('hello')
  terminal.sendInput('\r')
  await settleTui()
  assert.equal(submitted, 'hello')
  terminal.resize(40, 12)
  await settleTui()
  store.clearView()
  await settleTui()
  store.applyMany([{ kind: 'user-message', id: 'after', text: 'after clear', injected: false }])
  await settleTui()
  assert.match(terminal.getOutput(), /after clear/)
  app.stop()
})

test('global Ctrl+C is consumed before it reaches the focused editor', async () => {
  let quitCount = 0
  const terminal = new FakeTerminal()
  const store = new Store({ provider: 'provider', model: 'model', workspace: '/tmp' })
  const app = new AstraApp({
    store,
    bridge: idleBridge(),
    quit: () => { quitCount += 1 },
    sessionRoot: '/tmp/no-sessions',
    terminal,
  })
  app.start()
  await settleTui()

  terminal.sendInput('draft')
  await settleTui()
  assert.equal(app.getEditorText(), 'draft')

  terminal.sendInput('\u0003')
  await settleTui()
  assert.equal(quitCount, 1)
  assert.equal(app.getEditorText(), 'draft')
  app.stop()
})

test('running Esc is consumed, preserves editor text, and interrupts once', async () => {
  let interruptCount = 0
  const terminal = new FakeTerminal()
  const store = new Store({ provider: 'provider', model: 'model', workspace: '/tmp' })
  const app = new AstraApp({
    store,
    bridge: idleBridge({
      interrupt: async () => { interruptCount += 1 },
    }),
    quit: () => {},
    sessionRoot: '/tmp/no-sessions',
    terminal,
  })
  app.start()
  await settleTui()

  terminal.sendInput('draft')
  await settleTui()
  store.applyMany([{ kind: 'phase', status: 'running' }])
  await settleTui()

  terminal.sendInput('\u001b')
  terminal.sendInput('\u001b')
  await settleTui()
  assert.equal(interruptCount, 1)
  assert.equal(app.getEditorText(), 'draft')
  app.stop()
})

test('completed long output never contaminates the final editor/footer tail', async () => {
  const terminal = new FakeTerminal(60, 24)
  const store = new Store({ provider: 'provider', model: 'model', workspace: '/tmp' })
  const app = new AstraApp({
    store,
    bridge: idleBridge(),
    quit: () => {},
    sessionRoot: '/tmp/no-sessions',
    terminal,
  })
  app.start()
  await settleTui()

  const sentinel = 'BODY_SENTINEL'
  const longText = Array.from({ length: 32 }, (_, index) => `${sentinel} body row ${index}`).join('\n')
  store.applyMany([
    { kind: 'phase', status: 'idle' },
    { kind: 'user-message', id: 'long-user', text: 'long prompt', injected: false },
    { kind: 'assistant-text', text: longText },
  ])
  await settleTui()
  store.applyMany([{ kind: 'assistant-done' }])
  store.applyMany([{ kind: 'note', text: 'activity after completion' }])
  await settleTui()

  const snapshot = app.renderSnapshot()
  assert.equal(snapshot.some((line) => line.includes(sentinel)), true)
  const plain = snapshot.map((line) => stripTerminalSequences(line))
  const footerIndex = plain.findLastIndex((line) => line.includes('/ commands · provider/model'))
  assert.notEqual(footerIndex, -1)
  const activityIndex = plain.findLastIndex((line) => line.includes('activity after completion'))
  assert.notEqual(activityIndex, -1)
  assert.ok(activityIndex < footerIndex)
  // Only inspect the rows after the latest activity row. These are the
  // dynamic editor border/input/footer rows; body lines remain above the
  // activity row in the committed document.
  const finalTail = plain.slice(activityIndex + 1, footerIndex + 1)
  assert.equal(finalTail.some((line) => line.includes(sentinel)), false)
  app.stop()
})

test('81-column mixed CJK activity detail respects terminal cell width', async () => {
  const terminal = new FakeTerminal(81, 24)
  const store = new Store({ provider: 'provider', model: 'model', workspace: '/tmp' })
  const app = new AstraApp({
    store,
    bridge: idleBridge(),
    quit: () => {},
    sessionRoot: '/tmp/no-sessions',
    terminal,
  })
  app.start()
  await settleTui()

  store.applyMany([
    { kind: 'user-message', id: 'mixed-user', text: '混合宽度正文', injected: false },
    { kind: 'assistant-text', text: 'assistant 完成内容' },
    { kind: 'assistant-done' },
    {
      kind: 'tool-result',
      callId: 'call-mixed',
      ok: false,
      summary: '中文 detail with English words and CJK 字符'.repeat(4),
    },
  ])
  await settleTui()

  const lines = app.renderSnapshot()
  assert.ok(lines.length > 0)
  for (const line of lines) {
    assert.ok(
      visibleWidth(line) <= terminal.columns,
      `rendered line width ${visibleWidth(line)} exceeds ${terminal.columns}: ${JSON.stringify(line)}`,
    )
  }
  app.stop()
})

test('session and model overlays never widen past narrow renderer width', () => {
  const sessionPicker = new SessionPickerComponent({ onSelect: () => {}, onCancel: () => {} })
  sessionPicker.setSessions([{
    id: 'session-cjk',
    updatedAt: Date.now(),
    workspace: '/项目/中文目录',
    title: '非常长的中文会话标题 with English',
  }])
  for (const line of sessionPicker.render(3)) {
    assert.ok(visibleWidth(line) <= 3, `session overlay line widened: ${JSON.stringify(line)}`)
  }

  const modelPicker = new ModelPickerComponent(
    'providers',
    [],
    [{
      id: 'provider-cjk',
      name: '提供方 English',
      active: true,
      configured: true,
      builtIn: false,
      credentialConfigured: true,
      credentialWritable: true,
      baseURL: 'https://example.invalid/很长的路径',
      api: 'openai-completions',
      model: '模型',
    }],
    { provider: 'provider-cjk', model: '模型' },
    {
      onSelect: () => {},
      onSaveProvider: () => {},
      onTestProvider: () => {},
      onDeleteProvider: () => {},
      onCancel: () => {},
    },
  )
  for (const line of modelPicker.render(3)) {
    assert.ok(visibleWidth(line) <= 3, `model overlay line widened: ${JSON.stringify(line)}`)
  }
})

function stripTerminalSequences(value: string): string {
  return value
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/gu, '')
    .replace(/\u001b_[^\u0007]*\u0007/gu, '')
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, '')
}
