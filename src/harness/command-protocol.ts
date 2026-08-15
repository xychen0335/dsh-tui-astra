/** Project-local JSON-RPC extension for Harness human commands. */

export interface RuntimeCommandDescriptor {
  name: string
  description: string
  input?: { hint: string }
}

export interface CommandsListResult {
  commands: readonly RuntimeCommandDescriptor[]
}

export type RuntimeCommandResult =
  | { kind: 'success'; text?: string; sourceEventSeq?: number }
  | { kind: 'error'; text: string }

export interface CommandsExecuteResult {
  matched: boolean
  commandId?: string
  result?: RuntimeCommandResult
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) throw new TypeError('runtime command response must be an object')
  return value as Record<string, unknown>
}

/** Validate the untyped response returned by HarnessClient.request(). */
export function decodeCommandsList(value: unknown): readonly RuntimeCommandDescriptor[] {
  const commands = record(value)['commands']
  if (!Array.isArray(commands)) throw new TypeError('commands/list returned no command array')
  return commands.map((entry) => {
    const command = record(entry)
    if (typeof command['name'] !== 'string' || typeof command['description'] !== 'string') {
      throw new TypeError('commands/list returned an invalid command descriptor')
    }
    const inputValue = command['input']
    if (inputValue === undefined) {
      return { name: command['name'], description: command['description'] }
    }
    const input = record(inputValue)
    if (typeof input['hint'] !== 'string') throw new TypeError('commands/list returned an invalid input hint')
    return { name: command['name'], description: command['description'], input: { hint: input['hint'] } }
  })
}

/** Validate the untyped response returned by HarnessClient.request(). */
export function decodeCommandsExecute(value: unknown): CommandsExecuteResult {
  const response = record(value)
  if (typeof response['matched'] !== 'boolean') throw new TypeError('commands/execute returned no matched flag')
  if (!response['matched']) return { matched: false }
  if (typeof response['commandId'] !== 'string') throw new TypeError('commands/execute returned no command id')
  const resultValue = record(response['result'])
  if (resultValue['kind'] === 'success') {
    const text = resultValue['text']
    const sourceEventSeq = resultValue['sourceEventSeq']
    if (text !== undefined && typeof text !== 'string') throw new TypeError('commands/execute returned invalid success text')
    if (sourceEventSeq !== undefined && (!Number.isSafeInteger(sourceEventSeq) || (sourceEventSeq as number) < 0)) {
      throw new TypeError('commands/execute returned invalid source event sequence')
    }
    return {
      matched: true,
      commandId: response['commandId'],
      result: {
        kind: 'success',
        ...(text === undefined ? {} : { text }),
        ...(sourceEventSeq === undefined ? {} : { sourceEventSeq: sourceEventSeq as number }),
      },
    }
  }
  if (resultValue['kind'] === 'error' && typeof resultValue['text'] === 'string') {
    return {
      matched: true,
      commandId: response['commandId'],
      result: { kind: 'error', text: resultValue['text'] },
    }
  }
  throw new TypeError('commands/execute returned an invalid result')
}
