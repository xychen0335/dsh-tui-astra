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
import { SessionId } from '@deepseek-ai/dsh-session'

export { Config }

export const name = 'sdk-jsonrpc-server-resume'
export const inject = ['agents', 'sessionPersistence']

type UpstreamContext = Parameters<typeof applyUpstream>[0]
type UpstreamConfig = Parameters<typeof applyUpstream>[1]

interface AgentHandleLike {
  agent: {
    id: string
    followup(message: unknown): void
  }
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
}

interface ResumeAwareServer {
  ctx: ResumeRuntimeContext
  cwd: string
  provider: string
  model: string
  maxTokens?: number
  sessions: Map<string, { handle: AgentHandleLike }>
}

interface PatchableServerPrototype {
  createSession(this: ResumeAwareServer, sessionId: string): Promise<{ handle: AgentHandleLike }>
}

const prototype = HarnessSdkJsonRpcServer.prototype as unknown as PatchableServerPrototype

prototype.createSession = async function (sessionId: string): Promise<{ handle: AgentHandleLike }> {
  return createOrResumeRuntimeSession(this, sessionId)
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
