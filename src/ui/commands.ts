/** Discoverable slash commands shown by the input palette. */
export type CommandSource = 'local' | 'prompt' | 'runtime' | 'skill'

export interface SlashCommand {
  /** Lowercase command name without the leading slash. */
  name: string
  /** Optional free-form input hint. */
  inputHint?: string
  description: string
  source: CommandSource
  /** Whether this skill is also available to the model-facing skill tool. */
  modelInvocable?: boolean
}

export interface ParsedCommandLine {
  name: string
  /** Exact text following the command name, including separator whitespace. */
  rawInput: string
}

export const LOCAL_COMMANDS: readonly SlashCommand[] = [
  { name: 'help', description: 'show commands and keyboard help', source: 'local' },
  { name: 'new', inputHint: '[id]', description: 'start a fresh session', source: 'local' },
  { name: 'resume', inputHint: '[id]', description: 'browse or continue a saved session', source: 'local' },
  { name: 'sessions', description: 'list recent sessions across projects', source: 'local' },
  { name: 'clear', description: 'clear the screen, keep the session', source: 'local' },
  { name: 'status', description: 'show runtime and workspace status', source: 'local' },
  { name: 'session', description: 'show the current session id', source: 'local' },
  { name: 'model', inputHint: '[provider/model]', description: 'select or configure the session model', source: 'local' },
  { name: 'quit', description: 'exit dsh', source: 'local' },
]

export const PROMPT_COMMANDS: readonly SlashCommand[] = [
  { name: 'init', description: 'ask dsh to inspect and initialize the project', source: 'prompt' },
  { name: 'review', inputHint: '[scope]', description: 'ask dsh to review the current changes', source: 'prompt' },
]

export const STATIC_COMMANDS = mergeCommands(LOCAL_COMMANDS, PROMPT_COMMANDS)

/** Parse an exact slash command while preserving the handler-owned raw input. */
export function parseCommandLine(line: string): ParsedCommandLine | undefined {
  const match = /^\/([a-z][a-z0-9_-]*)(?=$|[\t\n\r ])/u.exec(line)
  const name = match?.[1]
  if (match === null || match === undefined || name === undefined) return undefined
  return { name, rawInput: line.slice(match[0].length) }
}

/** Merge command sources in priority order; the first definition wins. */
export function mergeCommands(...sources: readonly (readonly SlashCommand[])[]): readonly SlashCommand[] {
  const commands = new Map<string, SlashCommand>()
  for (const source of sources) {
    for (const command of source) {
      if (!commands.has(command.name)) commands.set(command.name, command)
    }
  }
  return [...commands.values()]
}

/** Return palette entries while a single slash-command token is being typed. */
export function matchingCommands(
  value: string,
  commands: readonly SlashCommand[] = STATIC_COMMANDS,
  limit = 6,
): readonly SlashCommand[] {
  if (!value.startsWith('/') || /\s/u.test(value)) return []
  const query = value.slice(1).toLowerCase()
  return commands.filter((command) => command.name.startsWith(query)).slice(0, limit)
}
