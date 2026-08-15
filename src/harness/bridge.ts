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
  private readonly client: HarnessClient
  private readonly onNotification: (notification: HarnessNotification) => void
  private readonly workspaceCwd: string
  private readonly provider: string
  private readonly model: string
  private sessionId: string
  private subscription: NotificationSubscription | undefined

  /**
   * @param options - launch spec and session route.
   * @param onNotification - receives every server notification until close.
   */
  constructor(options: BridgeOptions, onNotification: (notification: HarnessNotification) => void) {
    const launch: HarnessClientOptions = {
      command: options.command,
      args: options.args,
      cwd: options.runtimeCwd,
      env: options.env,
      requestTimeoutMs: undefined,
    }
    this.client = new HarnessClient(launch)
    this.onNotification = onNotification
    this.workspaceCwd = options.workspaceCwd
    this.provider = options.provider
    this.model = options.model
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
    this.client.start()
    try {
      await this.client.initialize({
        cwd: this.workspaceCwd,
        provider: this.provider,
        model: this.model,
      })
    } catch (error) {
      await this.client.close()
      throw error
    }
    this.subscription = this.client.subscribe()
    void this.deliver().catch((error: unknown) => {
      // The subscription rejects after close/runtime death; that is the
      // normal end of delivery, not a crash.
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
    return this.client.prompt(this.sessionId, [{ type: 'text', text }])
  }

  private async deliver(): Promise<void> {
    const subscription = this.subscription
    if (subscription === undefined) return
    for await (const notification of subscription) {
      this.onNotification(notification)
    }
  }

  /**
   * Shut the runtime down and reap the subprocess. Idempotent.
   * @returns settlement of the complete teardown.
   */
  async close(): Promise<void> {
    this.subscription?.close()
    this.subscription = undefined
    await this.client.close()
  }
}

function mintSessionId(): string {
  return `session-${randomUUID().replaceAll('-', '')}`
}
