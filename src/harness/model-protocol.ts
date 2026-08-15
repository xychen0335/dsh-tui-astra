/** Project-local JSON-RPC extension for model discovery, selection, and configuration. */

export interface RuntimeModelSelection {
  provider: string
  model: string
  reasoningEffort?: string
}

export interface RuntimeModelEntry {
  id: string
  name: string
  description?: string
}

export interface RuntimeModelGroup {
  id: string
  name: string
  models: readonly RuntimeModelEntry[]
}

export interface RuntimeModelsResult {
  current: RuntimeModelSelection
  groups: readonly RuntimeModelGroup[]
  failures: readonly { id: string; name: string; message: string }[]
}

export interface ConfigureProviderInput {
  provider: string
  model: string
  baseURL?: string
  api?: string
  apiKey?: string
}

export interface RuntimeProviderDescriptor {
  id: string
  name: string
  active: boolean
  configured: boolean
  builtIn: boolean
  declared?: boolean
  baseURL?: string
  api?: string
  model?: string
  credentialRef?: string
  credentialConfigured: boolean
  credentialSource?: string
  credentialWritable: boolean
}

export interface SaveProviderInput {
  provider: string
  model?: string
  baseURL?: string
  api?: string
  apiKey?: string
  select?: boolean
}

export interface TestProviderInput {
  provider: string
  baseURL?: string
  api?: string
  apiKey?: string
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) throw new TypeError('runtime model response must be an object')
  return value as Record<string, unknown>
}

function selection(value: unknown): RuntimeModelSelection {
  const input = record(value)
  if (typeof input['provider'] !== 'string' || typeof input['model'] !== 'string') {
    throw new TypeError('runtime returned an invalid model selection')
  }
  const effort = input['reasoningEffort']
  if (effort !== undefined && typeof effort !== 'string') {
    throw new TypeError('runtime returned an invalid reasoning effort')
  }
  return {
    provider: input['provider'],
    model: input['model'],
    ...(effort === undefined ? {} : { reasoningEffort: effort }),
  }
}

/** Validate the untyped response returned by models/list. */
export function decodeModels(value: unknown): RuntimeModelsResult {
  const response = record(value)
  if (!Array.isArray(response['groups']) || !Array.isArray(response['failures'])) {
    throw new TypeError('models/list returned an invalid directory')
  }
  return {
    current: selection(response['current']),
    groups: response['groups'].map((groupValue) => {
      const group = record(groupValue)
      if (typeof group['id'] !== 'string' || typeof group['name'] !== 'string' || !Array.isArray(group['models'])) {
        throw new TypeError('models/list returned an invalid provider group')
      }
      return {
        id: group['id'],
        name: group['name'],
        models: group['models'].map((modelValue) => {
          const model = record(modelValue)
          if (typeof model['id'] !== 'string' || typeof model['name'] !== 'string') {
            throw new TypeError('models/list returned an invalid model')
          }
          const description = model['description']
          if (description !== undefined && typeof description !== 'string') {
            throw new TypeError('models/list returned an invalid model description')
          }
          return {
            id: model['id'],
            name: model['name'],
            ...(description === undefined ? {} : { description }),
          }
        }),
      }
    }),
    failures: response['failures'].map((failureValue) => {
      const failure = record(failureValue)
      if (
        typeof failure['id'] !== 'string'
        || typeof failure['name'] !== 'string'
        || typeof failure['message'] !== 'string'
      ) {
        throw new TypeError('models/list returned an invalid failure')
      }
      return { id: failure['id'], name: failure['name'], message: failure['message'] }
    }),
  }
}

/** Validate the untyped response returned by models/select or models/configure. */
export function decodeSelectedModel(value: unknown): RuntimeModelSelection {
  return selection(record(value)['selected'])
}

/** Validate the untyped response returned by providers/list. */
export function decodeProviders(value: unknown): readonly RuntimeProviderDescriptor[] {
  const providers = record(value)['providers']
  if (!Array.isArray(providers)) throw new TypeError('providers/list returned no provider array')
  return providers.map((entryValue) => {
    const entry = record(entryValue)
    if (
      typeof entry['id'] !== 'string'
      || typeof entry['name'] !== 'string'
      || typeof entry['active'] !== 'boolean'
      || typeof entry['configured'] !== 'boolean'
      || typeof entry['builtIn'] !== 'boolean'
      || typeof entry['credentialConfigured'] !== 'boolean'
      || typeof entry['credentialWritable'] !== 'boolean'
    ) {
      throw new TypeError('providers/list returned an invalid provider descriptor')
    }
    const optional = ['baseURL', 'api', 'model', 'credentialRef', 'credentialSource'] as const
    for (const key of optional) {
      if (entry[key] !== undefined && typeof entry[key] !== 'string') {
        throw new TypeError(`providers/list returned an invalid ${key}`)
      }
    }
    if (entry['declared'] !== undefined && typeof entry['declared'] !== 'boolean') {
      throw new TypeError('providers/list returned an invalid declared flag')
    }
    const declared = entry['declared'] as boolean | undefined
    const baseURL = entry['baseURL'] as string | undefined
    const api = entry['api'] as string | undefined
    const model = entry['model'] as string | undefined
    const credentialRef = entry['credentialRef'] as string | undefined
    const credentialSource = entry['credentialSource'] as string | undefined
    return {
      id: entry['id'],
      name: entry['name'],
      active: entry['active'],
      configured: entry['configured'],
      builtIn: entry['builtIn'],
      ...(declared === undefined ? {} : { declared }),
      ...(baseURL === undefined ? {} : { baseURL }),
      ...(api === undefined ? {} : { api }),
      ...(model === undefined ? {} : { model }),
      ...(credentialRef === undefined ? {} : { credentialRef }),
      credentialConfigured: entry['credentialConfigured'],
      ...(credentialSource === undefined ? {} : { credentialSource }),
      credentialWritable: entry['credentialWritable'],
    }
  })
}

/** Validate an optional selection returned by providers/save. */
export function decodeSavedProvider(value: unknown): { selected?: RuntimeModelSelection } {
  const response = record(value)
  return response['selected'] === undefined ? {} : { selected: selection(response['selected']) }
}

/** Validate provider draft model discovery. */
export function decodeTestedProvider(value: unknown): readonly RuntimeModelEntry[] {
  const models = record(value)['models']
  if (!Array.isArray(models)) throw new TypeError('providers/test returned no model array')
  return models.map((entryValue) => {
    const entry = record(entryValue)
    if (typeof entry['id'] !== 'string') throw new TypeError('providers/test returned an invalid model')
    const name = entry['name']
    if (name !== undefined && typeof name !== 'string') throw new TypeError('providers/test returned an invalid name')
    return { id: entry['id'], name: name ?? entry['id'] }
  })
}
