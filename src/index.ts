#!/usr/bin/env node
/**
 * dsh entry: parse options, boot the runtime bridge, and render
 * the TUI. Ctrl+C and SIGTERM both close the runtime cleanly before exit.
 *
 * @module dsh-tui-astra/index
 */

import { HelpRequested, helpText, parseArgs, resolveRuntimeBin } from './config.ts'
import type { CliOptions } from './config.ts'
import { HarnessBridge } from './harness/bridge.ts'
import { NotificationClassifier } from './harness/events.ts'
import { mountApp } from './mount.ts'
import { Store } from './store.ts'

function fail(message: string): never {
  console.error(`dsh: ${message}`)
  console.error('Run with --help for usage.')
  process.exit(1)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function main(): Promise<void> {
  let options: CliOptions
  try {
    options = parseArgs(process.argv.slice(2))
  } catch (error) {
    if (error instanceof HelpRequested) {
      console.log(helpText())
      process.exit(0)
    }
    fail(errorMessage(error))
  }

  const store = new Store({ provider: options.provider, model: options.model, workspace: options.workspace })
  const notificationClassifier = new NotificationClassifier()

  let runtimeBin: string
  try {
    runtimeBin = options.runtimeCommand ?? resolveRuntimeBin()
  } catch (error) {
    fail(`cannot locate the dsh-jsonrpc-agent runtime: ${errorMessage(error)}`)
  }

  const bridge = new HarnessBridge({
    command: 'node',
    args: [runtimeBin, options.cordis],
    runtimeCwd: options.workspace,
    workspaceCwd: options.workspace,
    provider: options.provider,
    model: options.model,
    maxTokens: options.maxTokens,
    env: {
      ...process.env,
      DSH_CWD: options.workspace,
      DSH_SESSION_ROOT: options.sessionRoot,
      DSH_PROVIDER: options.provider,
      DSH_MODEL: options.model,
      ...(options.baseURL === undefined ? {} : { DSH_BASE_URL: options.baseURL }),
      ...(options.apiKeyEnv === undefined ? {} : { DSH_API_KEY_ENV: options.apiKeyEnv }),
      ...(options.api === undefined ? {} : { DSH_API: options.api }),
    },
  }, (notification) => {
    store.applyMany(notificationClassifier.classify(notification, bridge.getSessionId()))
  })

  if (options.session !== undefined) bridge.newSession(options.session)
  store.setSessionId(bridge.getSessionId())

  let exiting = false
  const quit = async (): Promise<void> => {
    if (exiting) return
    exiting = true
    try {
      await bridge.close()
    } catch {
      // Teardown is best effort; the runtime may already be gone.
    }
    app?.stop()
    process.exit(0)
  }
  process.on('SIGTERM', () => { void quit() })

  // `exitOnCtrlC: false` hands Ctrl+C to the component tree, which routes it
  // through the same clean shutdown path as /quit.
  const app = mountApp(store, bridge, () => { void quit() }, options.sessionRoot)

  try {
    await bridge.start()
    store.applyMany([
      { kind: 'phase', status: 'idle' },
      { kind: 'note', text: `runtime ready · workspace ${options.workspace}` },
    ])
  } catch (error) {
    store.applyMany([{ kind: 'error', text: `runtime start failed: ${errorMessage(error)}` }])
    // Keep the error visible long enough to read before the process exits.
    await new Promise((resolve) => { setTimeout(resolve, 2000) })
    await quit()
  }
}

void main()
