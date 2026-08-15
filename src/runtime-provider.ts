/**
 * Environment-driven custom provider composition.
 *
 * The runtime always keeps the first-party `deepseek-official` adapter. Any
 * other route is registered through the generic pi-ai adapter from public,
 * non-secret environment facts; only the credential variable name enters the
 * plugin config.
 */

import type { Context } from '@deepseek-ai/cordis'
import * as PiAi from '@deepseek-ai/dsh-llm-pi-ai'
import type { Config as PiAiConfig } from '@deepseek-ai/dsh-llm-pi-ai'

export const name = 'runtime-provider'

type ProviderEnvironment = Readonly<Record<string, string | undefined>>

/** Build a provider profile without ever copying a literal credential value. */
export function customProviderConfig(environment: ProviderEnvironment): PiAiConfig {
  const provider = environment['DSH_PROVIDER']?.trim()
  const model = environment['DSH_MODEL']?.trim()
  if (provider === undefined || provider === '' || provider === 'deepseek-official') return { providers: {} }
  if (model === undefined || model === '') throw new Error(`provider "${provider}" requires DSH_MODEL`)

  const baseURL = environment['DSH_BASE_URL']?.trim()
  const api = environment['DSH_API']?.trim()
  const configuredApiKeyEnv = environment['DSH_API_KEY_ENV']?.trim()
  // A literal key remains only in process.env. The plugin config carries its
  // reference, never the value, so diagnostics and serialized config stay safe.
  const apiKeyEnv = configuredApiKeyEnv === undefined || configuredApiKeyEnv === ''
    ? (environment['DSH_API_KEY'] === undefined ? undefined : 'DSH_API_KEY')
    : configuredApiKeyEnv
  return {
    providers: {
      [provider]: {
        ...(apiKeyEnv === undefined || apiKeyEnv === '' ? {} : { apiKeyEnv }),
        ...(api === undefined || api === '' ? {} : { api }),
        ...(baseURL === undefined || baseURL === '' ? {} : { baseURL }),
        models: [{ id: model }],
      },
    },
  }
}

/** Mount the generic adapter only when a non-DeepSeek route was requested. */
export function apply(ctx: Context): void {
  const config = customProviderConfig(process.env)
  ctx.plugin(PiAi, config)
}
