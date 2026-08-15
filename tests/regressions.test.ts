import assert from 'node:assert/strict'
import test from 'node:test'
import { homedir } from 'node:os'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { zstdCompressSync } from 'node:zlib'
import type { HarnessNotification } from '@deepseek-ai/dsh-sdk-client'
import { parseArgs } from '../src/config.ts'
import { NotificationClassifier, classifySessionEvent } from '../src/harness/events.ts'
import { Store } from '../src/store.ts'
import { listSessions, loadSession, projectKey, scanZstdFrames } from '../src/sessions.ts'
import { activityRows } from '../src/ui/activity.tsx'
import { chatRows, wrapRows } from '../src/ui/chat.tsx'
import {
  LOCAL_COMMANDS,
  mergeCommands,
  matchingCommands,
  parseCommandLine,
} from '../src/ui/commands.ts'
import { nextGraphemeBoundary, previousGraphemeBoundary } from '../src/ui/input.tsx'
import { relativeTime, shortSessionId } from '../src/ui/session-picker.tsx'
import {
  createOrResumeRuntimeSession,
  executeRuntimeCommand,
  listRuntimeCommands,
  listRuntimeSkills,
} from '../src/runtime-server.ts'

function notification(method: string, params: Record<string, unknown>): HarnessNotification {
  return { method, params } as HarnessNotification
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

test('cursor movement keeps Unicode graphemes intact', () => {
  const text = 'A👨‍👩‍👧‍👦éB'
  const afterA = nextGraphemeBoundary(text, 0)
  const afterEmoji = nextGraphemeBoundary(text, afterA)
  const afterAccent = nextGraphemeBoundary(text, afterEmoji)
  assert.equal(text.slice(afterA, afterEmoji), '👨‍👩‍👧‍👦')
  assert.equal(text.slice(afterEmoji, afterAccent), 'é')
  assert.equal(previousGraphemeBoundary(text, afterAccent), afterEmoji)
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
