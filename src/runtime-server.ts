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
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { CommandDescriptor, CommandExecution } from '@deepseek-ai/dsh-commands'
import { isUserInvocable } from '@deepseek-ai/dsh-skill'
import type { SkillSummary } from '@deepseek-ai/dsh-skill'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {
  CommandsExecuteResult,
  CommandsListResult,
} from './harness/command-protocol.ts'

export { Config }

export const name = 'sdk-jsonrpc-server-resume'
export const inject = ['agents', 'commands', 'sessionPersistence', 'skills']

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
