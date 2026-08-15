/**
 * HarnessBridge — owns the DSH runtime subprocess and the SDK wire.
 *
 * Wraps the low-level {@link HarnessClient} (explicit start/initialize/
 * prompt/close) so the TUI can stream `session.event` notifications live
 * instead of waiting for a whole run to settle, which the high-level
 * `DeepSeekHarness.run` API would do. Sending is just enqueueing a prompt;
 * the runtime creates the session on first use.
 *
 * @module dsh-tui-astra/harness/bridge
 */

import { randomUUID } from 'node:crypto'
import { HarnessClient } from '@deepseek-ai/dsh-sdk-client'
import type { HarnessClientOptions, HarnessNotification, NotificationSubscription } from '@deepseek-ai/dsh-sdk-client'

/** Launch plus session-route settings for one bridge. */
export interface BridgeOptions {
  /** Runtime executable (the `dsh-jsonrpc-agent` bin) and its cordis.yml argument. */
  command: string
  /** Arguments for {@link command} — the cordis.yml path, typically. */
  args: string[]
  /** Working directory for the runtime process itself. */
  runtimeCwd: string
  /** Agent workspace recorded on the session (bash/fs root inside the runtime). */
  workspaceCwd: string
  /** Provider route for the session's agents. */
  provider: string
  /** Model for the session's agents. */
  model: string
  /** Optional per-request output-token cap. */
  maxTokens?: number
  /** Complete child environment; `undefined` inherits the parent's. */
  env?: NodeJS.ProcessEnv
}

export class HarnessBridge {
  private readonly launch: HarnessClientOptions
  private client: HarnessClient | undefined
  private readonly onNotification: (notification: HarnessNotification) => void
  private readonly workspaceCwd: string
  private readonly provider: string
  private readonly model: string
  private readonly maxTokens: number | undefined
  private sessionId: string
  private subscription: NotificationSubscription | undefined
  private closed = false
  private restarting = false
  private restartTask: Promise<void> | undefined

  /**
   * @param options - launch spec and session route.
   * @param onNotification - receives every server notification until close.
   */
  constructor(options: BridgeOptions, onNotification: (notification: HarnessNotification) => void) {
    this.launch = {
      command: options.command,
      args: options.args,
      cwd: options.runtimeCwd,
      env: options.env,
      requestTimeoutMs: undefined,
      // There is no protocol cancel. Esc replaces the subprocess, so keep the
      // SDK's shutdown/EOF/SIGTERM ladder short enough to feel interactive.
      shutdownTimeoutMs: 250,
      disposeEofGraceMs: 250,
      disposeGraceMs: 750,
    }
    this.onNotification = onNotification
    this.workspaceCwd = options.workspaceCwd
    this.provider = options.provider
    this.model = options.model
    this.maxTokens = options.maxTokens
    this.sessionId = mintSessionId()
  }

  /** The current session id; the runtime creates it lazily on first prompt. */
  getSessionId(): string {
    return this.sessionId
  }

  /**
   * Mint a fresh session id (or adopt an explicit one) for subsequent
   * prompts; no wire traffic until the next prompt.
   * @param id - explicit session id to adopt; omitted mints a fresh one.
   * @returns the new session id.
   */
  newSession(id?: string): string {
    this.sessionId = id ?? mintSessionId()
    return this.sessionId
  }

  /**
   * Start the runtime subprocess, perform the initialize handshake, and begin
   * streaming notifications. On failure the runtime is reaped and rethrown;
   * the bridge stays closed.
   */
  async start(): Promise<void> {
    if (this.closed) throw new Error('bridge is closed')
    if (this.client !== undefined) return
    const client = new HarnessClient(this.launch)
    this.client = client
    client.start()
    try {
      await client.initialize({
        cwd: this.workspaceCwd,
        provider: this.provider,
        model: this.model,
        ...this.maxTokens === undefined ? {} : { maxTokens: this.maxTokens },
      })
    } catch (error) {
      this.client = undefined
      await client.close()
      throw error
    }
    if (this.closed || this.client !== client) {
      await client.close()
      return
    }
    const subscription = client.subscribe()
    this.subscription = subscription
    void this.deliver(subscription).catch((error: unknown) => {
      // The subscription rejects after close/runtime death; that is the
      // normal end of delivery, not a crash.
      if (this.closed || this.restarting || this.subscription !== subscription) return
      const message = error instanceof Error ? error.message : String(error)
      this.onNotification({ method: 'session.event', params: { error: message } as never })
    })
  }

  /**
   * Queue one prompt on the current session.
   * @param text - the user message text, sent verbatim.
   * @returns the durable inbox message id.
   */
  async send(text: string): Promise<string> {
    // The input remains usable while Esc replaces the runtime. Preserve the
    // first follow-up instead of rejecting it during that short hand-off.
    const restart = this.restartTask
    if (restart !== undefined) await restart
    const client = this.client
    if (client === undefined) throw new Error('runtime is not running')
    return client.prompt(this.sessionId, [{ type: 'text', text }])
  }

  private async deliver(subscription: NotificationSubscription): Promise<void> {
    for await (const notification of subscription) {
      this.onNotification(notification)
    }
  }

  /** Abort the active turn by replacing the runtime, retaining the session id. */
  async interrupt(): Promise<void> {
    if (this.closed) throw new Error('bridge is closed')
    if (this.restartTask !== undefined) return this.restartTask
    this.restartTask = this.restartRuntime()
    try {
      await this.restartTask
    } finally {
      this.restartTask = undefined
    }
  }

  private async restartRuntime(): Promise<void> {
    this.restarting = true
    const subscription = this.subscription
    const client = this.client
    this.subscription = undefined
    this.client = undefined
    subscription?.close()
    try {
      if (client !== undefined) {
        try {
          await client.close()
        } catch {
          // The interrupted subprocess may already have died; replacement is
          // still the recovery path that makes the input usable again.
        }
      }
      await this.start()
    } finally {
      this.restarting = false
    }
  }

  /**
   * Shut the runtime down and reap the subprocess. Idempotent.
   * @returns settlement of the complete teardown.
   */
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.subscription?.close()
    this.subscription = undefined
    const client = this.client
    this.client = undefined
    if (client !== undefined) await client.close()
  }
}

function mintSessionId(): string {
  return `session-${randomUUID().replaceAll('-', '')}`
}
