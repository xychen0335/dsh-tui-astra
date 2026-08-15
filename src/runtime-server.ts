/**
 * Resume-aware wrapper around the upstream SDK JSON-RPC server.
 *
 * rc.6 always calls `agents.create()` for an id unknown to the current
 * process. That is correct for a fresh id, but after Esc replaces the process
 * the same id already exists in persistence and must go through
 * `agents.resume()` instead. Patch the server's private (runtime-visible)
 * creation seam before mounting its otherwise unchanged transport plugin.
 */

import {
  Config,
  HarnessSdkJsonRpcServer,
  apply as applyUpstream,
} from '@deepseek-ai/dsh-sdk-jsonrpc-server'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { Agent, ModelSelection, ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import type { CommandDescriptor, CommandExecution } from '@deepseek-ai/dsh-commands'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type { LlmModelInfo, LlmProviderInfo, LlmResolvedModelInfo } from '@deepseek-ai/dsh-llm'
import { isUserInvocable } from '@deepseek-ai/dsh-skill'
import type { SkillSummary } from '@deepseek-ai/dsh-skill'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import type { SettingsPathOp, SettingsProvider } from '@deepseek-ai/dsh-settings'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {
  CommandsExecuteResult,
  CommandsListResult,
} from './harness/command-protocol.ts'

export { Config }

export const name = 'sdk-jsonrpc-server-resume'
export const inject = ['agents', 'commands', 'credentials', 'llm', 'sessionPersistence', 'settings', 'skills']

type UpstreamContext = Parameters<typeof applyUpstream>[0]
type UpstreamConfig = Parameters<typeof applyUpstream>[1]

interface AgentHandleLike {
  agent: Agent
  dispose(): Promise<void>
}

interface ResumeRuntimeContext {
  agents: {
    create(options: {
      sessionId: ReturnType<typeof SessionId>
      meta: { cwd: string }
      agentOptions: { provider: string; model: string; maxTokens?: number }
    }): Promise<AgentHandleLike>
    resume(options: {
      resumeSessionId: ReturnType<typeof SessionId>
      agentOptions: { provider: string; model: string; maxTokens?: number }
    }): Promise<AgentHandleLike>
  }
  sessionPersistence: {
    list(): Promise<readonly { id: string }[]>
  }
  commands: {
    list(agent: Agent): readonly CommandDescriptor[]
    execute(agent: Agent, line: string, signal: AbortSignal): Promise<CommandExecution | undefined>
  }
  skills: {
    list(options: { cwd?: string; scope?: Agent; signal?: AbortSignal }): Promise<SkillSummary[]>
  }
  llm: {
    listProviders(): LlmProviderInfo[]
    listModels(provider: string): Promise<LlmModelInfo[]>
    resolveModelInfo(provider: string, model: string): Promise<LlmResolvedModelInfo>
    resolveCallConfig(config: { provider: string; model: string }): Promise<{ provider: string; model: string }>
  }
  credentials: CredentialProvider
  settings: SettingsProvider
}

interface ResumeAwareServer {
  ctx: ResumeRuntimeContext
  cwd: string
  provider: string
  model: string
  maxTokens?: number
  sessions: Map<string, { handle: AgentHandleLike }>
  getOrCreateSession?(sessionId: string): Promise<{ handle: AgentHandleLike }>
  handleRequest(method: string, params: Record<string, unknown> | undefined): Promise<unknown>
}

interface PatchableServerPrototype {
  createSession(this: ResumeAwareServer, sessionId: string): Promise<{ handle: AgentHandleLike }>
  handleRequest(this: ResumeAwareServer, method: string, params: Record<string, unknown> | undefined): Promise<unknown>
}

const prototype = HarnessSdkJsonRpcServer.prototype as unknown as PatchableServerPrototype
const upstreamHandleRequest = prototype.handleRequest

prototype.createSession = async function (sessionId: string): Promise<{ handle: AgentHandleLike }> {
  return createOrResumeRuntimeSession(this, sessionId)
}

prototype.handleRequest = async function (
  method: string,
  params: Record<string, unknown> | undefined,
): Promise<unknown> {
  if (method === 'commands/list') {
    return listRuntimeCommands(this, requiredString(params, 'sessionId'))
  }
  if (method === 'commands/execute') {
    return executeRuntimeCommand(
      this,
      requiredString(params, 'sessionId'),
      requiredString(params, 'line'),
    )
  }
  if (method === 'skills/list') {
    return listRuntimeSkills(this, requiredString(params, 'sessionId'))
  }
  if (method === 'models/list') {
    return listRuntimeModels(this, requiredString(params, 'sessionId'))
  }
  if (method === 'models/select') {
    return selectRuntimeModel(
      this,
      requiredString(params, 'sessionId'),
      requiredString(params, 'provider'),
      requiredString(params, 'model'),
    )
  }
  if (method === 'models/configure') {
    return configureRuntimeProvider(this, {
      sessionId: requiredString(params, 'sessionId'),
      provider: requiredString(params, 'provider'),
      model: requiredString(params, 'model'),
      baseURL: optionalString(params, 'baseURL'),
      api: optionalString(params, 'api'),
      apiKey: optionalString(params, 'apiKey'),
    })
  }
  return upstreamHandleRequest.call(this, method, params)
}

/** List commands visible to the exact session agent. */
export async function listRuntimeCommands(
  server: Pick<ResumeAwareServer, 'ctx' | 'sessions' | 'getOrCreateSession'>,
  sessionId: string,
): Promise<CommandsListResult> {
  const agent = await runtimeAgent(server, sessionId)
  return { commands: server.ctx.commands.list(agent) }
}

/** Execute a direct human command without sending it to the model. */
export async function executeRuntimeCommand(
  server: Pick<ResumeAwareServer, 'ctx' | 'sessions' | 'getOrCreateSession'>,
  sessionId: string,
  line: string,
): Promise<CommandsExecuteResult> {
  const agent = await runtimeAgent(server, sessionId)
  const execution = await server.ctx.commands.execute(agent, line, new AbortController().signal)
  if (execution === undefined) return { matched: false }
  return {
    matched: true,
    commandId: String(execution.commandId),
    result: execution.result,
  }
}

/** List user-invocable skills visible to the exact session agent and workspace. */
export async function listRuntimeSkills(
  server: Pick<ResumeAwareServer, 'ctx' | 'sessions' | 'getOrCreateSession'>,
  sessionId: string,
): Promise<{
  skills: readonly {
    name: string
    description: string
    modelInvocable: boolean
    source: string
  }[]
}> {
  const agent = await runtimeAgent(server, sessionId)
  const skills = await server.ctx.skills.list({
    cwd: agent.session.header.cwd,
    scope: agent,
  })
  return {
    skills: skills.filter(isUserInvocable).map((skill) => ({
      name: skill.name,
      description: skill.description,
      modelInvocable: skill.invocation.modelInvocable,
      source: skill.source,
    })),
  }
}

/** Return the registered provider/model directory and this session's current route. */
export async function listRuntimeModels(
  server: Pick<ResumeAwareServer, 'ctx' | 'sessions' | 'getOrCreateSession'>,
  sessionId: string,
): Promise<{
  current: ModelSelection
  groups: readonly {
    id: string
    name: string
    models: readonly { id: string; name: string; description?: string }[]
  }[]
  failures: readonly { id: string; name: string; message: string }[]
}> {
  const agent = await runtimeAgent(server, sessionId)
  const current = modelSelectionFor(agent).current
  const catalog = await Promise.all(server.ctx.llm.listProviders().map(async (provider) => {
    try {
      const models = await server.ctx.llm.listModels(provider.id)
      return {
        kind: 'group' as const,
        group: {
          id: provider.id,
          name: provider.name,
          models: models.map((model) => ({
            id: model.id,
            name: model.name,
            ...(model.description === undefined ? {} : { description: model.description }),
          })),
        },
      }
    } catch (error: unknown) {
      return {
        kind: 'failure' as const,
        failure: {
          id: provider.id,
          name: provider.name,
          message: error instanceof Error ? error.message : String(error),
        },
      }
    }
  }))
  return {
    current: { ...current },
    groups: catalog.flatMap((entry) => entry.kind === 'group' && entry.group.models.length > 0 ? [entry.group] : []),
    failures: catalog.flatMap((entry) => entry.kind === 'failure' ? [entry.failure] : []),
  }
}

/** Select a validated route for the current session's next assembled step. */
export async function selectRuntimeModel(
  server: Pick<ResumeAwareServer, 'ctx' | 'sessions' | 'getOrCreateSession'>,
  sessionId: string,
  provider: string,
  model: string,
): Promise<{ selected: ModelSelection }> {
  const agent = await runtimeAgent(server, sessionId)
  const resolved = await server.ctx.llm.resolveCallConfig({ provider, model })
  const selected = { provider: resolved.provider, model: resolved.model }
  modelSelectionFor(agent).current = selected
  return { selected }
}

/** Store one pi-ai provider profile and optional credential, then select it. */
export async function configureRuntimeProvider(
  server: Pick<ResumeAwareServer, 'ctx' | 'sessions' | 'getOrCreateSession'>,
  input: {
    sessionId: string
    provider: string
    model: string
    baseURL?: string
    api?: string
    apiKey?: string
  },
): Promise<{ selected: ModelSelection }> {
  if (input.provider === 'deepseek-official') {
    if (input.apiKey !== undefined && input.apiKey !== '') {
      await server.ctx.credentials.set(credentialRef('DEEPSEEK_API_KEY'), input.apiKey)
    }
    if (input.baseURL !== undefined && input.baseURL !== '') {
      await server.ctx.settings.mutate(settingsNamespace('llm-deepseek'), [{
        op: 'set',
        path: ['baseURL'],
        value: input.baseURL,
      }])
    }
    return selectRuntimeModel(server, input.sessionId, input.provider, input.model)
  }
  const refName = providerCredentialRef(input.provider)
  if (input.apiKey !== undefined && input.apiKey !== '') {
    await server.ctx.credentials.set(credentialRef(refName), input.apiKey)
  }
  const profile = {
    apiKeyEnv: refName,
    ...(input.baseURL === undefined || input.baseURL === '' ? {} : { baseURL: input.baseURL }),
    ...(input.api === undefined || input.api === '' ? {} : { api: input.api }),
    models: [{ id: input.model }],
  }
  const operation: SettingsPathOp = {
    op: 'set',
    path: ['providers', input.provider],
    value: profile,
  }
  await server.ctx.settings.mutate(settingsNamespace('llm-pi-ai'), [operation])
  return selectRuntimeModel(server, input.sessionId, input.provider, input.model)
}

/** Select the correct agent factory path for a process-local unknown id. */
export async function createOrResumeRuntimeSession(
  server: ResumeAwareServer,
  sessionId: string,
): Promise<{ handle: AgentHandleLike }> {
  const id = SessionId(sessionId)
  const agentOptions = {
    provider: server.provider,
    model: server.model,
    ...(server.maxTokens === undefined ? {} : { maxTokens: server.maxTokens }),
  }
  const persisted = (await server.ctx.sessionPersistence.list()).some((header) => header.id === sessionId)
  const handle = persisted
    ? await server.ctx.agents.resume({ resumeSessionId: id, agentOptions })
    : await server.ctx.agents.create({ sessionId: id, meta: { cwd: server.cwd }, agentOptions })
  const record = { handle }
  server.sessions.set(sessionId, record)
  return record
}

/** Mount the upstream transport after installing the resume-aware seam. */
export function apply(ctx: UpstreamContext, config: UpstreamConfig): void {
  applyUpstream(ctx, config)
}

async function runtimeAgent(
  server: Pick<ResumeAwareServer, 'sessions' | 'getOrCreateSession'>,
  sessionId: string,
): Promise<Agent> {
  const existing = server.sessions.get(sessionId)
  if (existing !== undefined) return existing.handle.agent
  if (server.getOrCreateSession === undefined) throw new Error(`runtime session is not active: ${sessionId}`)
  return (await server.getOrCreateSession(sessionId)).handle.agent
}

function requiredString(params: Record<string, unknown> | undefined, key: string): string {
  const value = params?.[key]
  if (typeof value !== 'string' || value.length === 0) throw new TypeError(`${key} must be a non-empty string`)
  return value
}

function optionalString(params: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = params?.[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new TypeError(`${key} must be a string`)
  return value
}

const modelSelections = new WeakMap<Agent, ModelSelectionRef>()

/** Install the same agent-scoped hot-switch seam used by the official Web host. */
function modelSelectionFor(agent: Agent): ModelSelectionRef & { current: ModelSelection } {
  const installed = modelSelections.get(agent)
  if (installed !== undefined) return installed as ModelSelectionRef & { current: ModelSelection }
  let picked: ModelSelection | undefined
  const selection: ModelSelectionRef = {
    get current(): ModelSelection {
      if (picked !== undefined) return picked
      const logged = agent.session.requestHeader()?.config
      if (logged !== undefined) {
        return {
          provider: logged.provider,
          model: logged.model,
          ...(logged.reasoningEffort === undefined ? {} : { reasoningEffort: logged.reasoningEffort }),
        }
      }
      if (agent.options.provider === undefined || agent.options.model === undefined) {
        throw new Error(`agent "${String(agent.id)}" has no model selection`)
      }
      return { provider: agent.options.provider, model: agent.options.model }
    },
    set current(next: ModelSelection) {
      picked = { ...next }
    },
    assembled: undefined,
  }
  installModelSelection(agent.ctx, selection)
  modelSelections.set(agent, selection)
  return selection as ModelSelectionRef & { current: ModelSelection }
}

function providerCredentialRef(provider: string): string {
  const normalized = provider.toUpperCase().replaceAll(/[^A-Z0-9_]/gu, '_')
  return `DSH_PROVIDER_${normalized}_API_KEY`
}
