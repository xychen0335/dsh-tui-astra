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
