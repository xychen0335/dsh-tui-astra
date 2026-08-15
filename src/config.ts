/**
 * CLI argument parsing for the TUI entry point.
 *
 * @module dsh-tui-astra/config
 */

import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface CliOptions {
  /** Agent workspace (bash/fs root) — also the runtime process cwd. */
  workspace: string
  /** Provider route for the session. */
  provider: string
  /** Model for the session. */
  model: string
  /** Custom provider endpoint. */
  baseURL?: string
  /** Environment-variable name containing the provider credential. */
  apiKeyEnv?: string
  /** Wire protocol for a hand-declared provider route. */
  api?: string
  /** Optional output-token cap per model request. */
  maxTokens?: number
  /** Session id to reuse; omitted mints a fresh one. */
  session?: string
  /** Shared durable-session root, aligned with the native Harness home. */
  sessionRoot: string
  /** Cordis composition for the runtime. */
  cordis: string
  /** Runtime executable override (testing/advanced). */
  runtimeCommand?: string
}

/** Locate the shipped runtime composition next to this package. */
export function defaultCordisPath(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  return join(here, '..', 'runtime', 'tui.cordis.yml')
}

/** Resolve the native Harness session root without hard-coding a user home. */
export function defaultSessionRoot(): string {
  const dshHome = process.env['DSH_HOME'] ?? join(homedir(), '.dsh')
  return resolve(process.env['DSH_SESSION_ROOT'] ?? join(dshHome, 'sessions'))
}

/** Resolve the `dsh-jsonrpc-agent` bin from the installed demo package. */
export function resolveRuntimeBin(): string {
  const require = createRequire(import.meta.url)
  const packageJson = require.resolve('@deepseek-ai/dsh-sdk-jsonrpc-demo/package.json')
  const { bin } = JSON.parse(require('node:fs').readFileSync(packageJson, 'utf8')) as {
    bin?: Record<string, string>
  }
  const entry = bin?.['dsh-jsonrpc-agent']
  if (entry === undefined) {
    throw new Error('@deepseek-ai/dsh-sdk-jsonrpc-demo does not expose the dsh-jsonrpc-agent bin')
  }
  return resolve(dirname(packageJson), entry)
}

/**
 * Parse argv (excluding node and script) into options.
 * @param argv - `process.argv.slice(2)`.
 * @returns resolved options; unknown flags throw.
 */
export function parseArgs(argv: readonly string[]): CliOptions {
  const provider = process.env['DSH_PROVIDER'] ?? 'deepseek-official'
  const environmentModel = process.env['DSH_MODEL']
  const options: CliOptions = {
    workspace: resolve(process.env['DSH_CWD'] ?? process.cwd()),
    provider,
    model: environmentModel ?? '',
    ...(process.env['DSH_BASE_URL'] === undefined ? {} : { baseURL: process.env['DSH_BASE_URL'] }),
    ...(process.env['DSH_API_KEY_ENV'] === undefined ? {} : { apiKeyEnv: process.env['DSH_API_KEY_ENV'] }),
    ...(process.env['DSH_API'] === undefined ? {} : { api: process.env['DSH_API'] }),
    sessionRoot: defaultSessionRoot(),
    cordis: defaultCordisPath(),
  }

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    switch (arg) {
      case '--cwd': {
        const value = argv[++i]
        if (value === undefined) throw new Error(`${arg} requires a value`)
        options.workspace = resolve(value)
        break
      }
      case '--model': {
        const value = argv[++i]
        if (value === undefined) throw new Error(`${arg} requires a value`)
        options.model = value
        break
      }
      case '--provider': {
        const value = argv[++i]
        if (value === undefined) throw new Error(`${arg} requires a value`)
        options.provider = value
        break
      }
      case '--base-url': {
        const value = argv[++i]
        if (value === undefined) throw new Error(`${arg} requires a value`)
        options.baseURL = value
        break
      }
      case '--api-key-env': {
        const value = argv[++i]
        if (value === undefined) throw new Error(`${arg} requires a value`)
        options.apiKeyEnv = value
        break
      }
      case '--api': {
        const value = argv[++i]
        if (value === undefined) throw new Error(`${arg} requires a value`)
        options.api = value
        break
      }
      case '--session': {
        const value = argv[++i]
        if (value === undefined) throw new Error(`${arg} requires a value`)
        options.session = value
        break
      }
      case '--max-tokens': {
        const value = argv[++i]
        if (value === undefined) throw new Error(`${arg} requires a value`)
        const parsed = Number(value)
        if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`${arg} must be a positive integer`)
        options.maxTokens = parsed
        break
      }
      case '--cordis': {
        const value = argv[++i]
        if (value === undefined) throw new Error(`${arg} requires a value`)
        options.cordis = resolve(value)
        break
      }
      case '--runtime-command': {
        const value = argv[++i]
        if (value === undefined) throw new Error(`${arg} requires a value`)
        options.runtimeCommand = value
        break
      }
      case '--help': {
        throw new HelpRequested()
      }
      default:
        throw new Error(`unknown option: ${arg}`)
    }
  }

  if (options.model === '') {
    if (options.provider === 'deepseek-official') options.model = 'deepseek-v4-flash'
    else throw new Error(`provider "${options.provider}" requires --model or DSH_MODEL`)
  }
  return options
}

export class HelpRequested extends Error {}

/** The CLI help text. */
export function helpText(): string {
  return `dsh — a terminal TUI client for DeepSeek Harness

Usage: dsh [options]

Options:
  --cwd <dir>           agent workspace (bash/fs root) [default: current dir]
  --model <name>        model id [default: $DSH_MODEL; DeepSeek uses deepseek-v4-flash]
  --provider <name>     provider route [default: $DSH_PROVIDER or deepseek-official]
  --base-url <url>      custom provider endpoint [default: $DSH_BASE_URL]
  --api-key-env <name>  credential environment-variable name [default: $DSH_API_KEY_ENV]
  --api <protocol>      custom route protocol [default: $DSH_API]
  --session <id>        reuse a session id
  --max-tokens <n>      output-token cap per model request
  --cordis <path>       runtime cordis.yml [default: bundled tui.cordis.yml]
  --runtime-command <c> runtime executable override
  --help                show this help

Environment:
  DEEPSEEK_API_KEY      credential (required unless a provider default exists)
  DEEPSEEK_BASE_URL     optional endpoint override
  DSH_CWD               workspace when --cwd is absent
  DSH_PROVIDER          provider route when --provider is absent
  DSH_MODEL             model when --model is absent
  DSH_BASE_URL          custom provider endpoint
  DSH_API_KEY           custom provider credential (read from the environment only)
  DSH_API_KEY_ENV       credential environment-variable name
  DSH_API               custom provider protocol (for example openai-completions)
  DSH_AGENTS_HOME       shared agent config root [default: ~/.agents]
  DSH_HOME              Harness home [default: ~/.dsh]
  DSH_SESSION_ROOT      session JSONL directory [default: $DSH_HOME/sessions]

Keys inside the TUI:
  PageUp / PageDown     scroll conversation history
  Ctrl+C                quit (closes the runtime cleanly)
  /new [id]             start a fresh session
  /quit                 quit
  /help                 show key help
`
}
