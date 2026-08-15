/** Discoverable slash commands shown by the input palette. */
export interface SlashCommand {
  name: string
  args: string
  description: string
}

export const SLASH_COMMANDS: readonly SlashCommand[] = [
  { name: '/help', args: '', description: 'show commands and keyboard help' },
  { name: '/new', args: '[id]', description: 'start a fresh session' },
  { name: '/resume', args: '[id]', description: 'browse or continue a saved session' },
  { name: '/sessions', args: '', description: 'list recent sessions across projects' },
  { name: '/clear', args: '', description: 'clear the screen, keep the session' },
  { name: '/status', args: '', description: 'show runtime and workspace status' },
  { name: '/session', args: '', description: 'show the current session id' },
  { name: '/model', args: '[name]', description: 'show model or print switch instructions' },
  { name: '/init', args: '', description: 'ask dsh to inspect and initialize the project' },
  { name: '/review', args: '[scope]', description: 'ask dsh to review the current changes' },
  { name: '/quit', args: '', description: 'exit dsh' },
]

/** Return palette entries while a single slash-command token is being typed. */
export function matchingCommands(value: string, limit = 6): readonly SlashCommand[] {
  if (!value.startsWith('/') || /\s/.test(value)) return []
  const query = value.toLowerCase()
  return SLASH_COMMANDS.filter((command) => command.name.startsWith(query)).slice(0, limit)
}
