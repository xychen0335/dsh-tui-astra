/** Project-local JSON-RPC extension for user-invocable Harness skills. */

export interface RuntimeSkillDescriptor {
  name: string
  description: string
  modelInvocable: boolean
  source: string
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) throw new TypeError('runtime skill response must be an object')
  return value as Record<string, unknown>
}

/** Validate the untyped response returned by HarnessClient.request(). */
export function decodeSkillsList(value: unknown): readonly RuntimeSkillDescriptor[] {
  const skills = record(value)['skills']
  if (!Array.isArray(skills)) throw new TypeError('skills/list returned no skill array')
  return skills.map((entry) => {
    const skill = record(entry)
    if (
      typeof skill['name'] !== 'string'
      || typeof skill['description'] !== 'string'
      || typeof skill['modelInvocable'] !== 'boolean'
      || typeof skill['source'] !== 'string'
    ) {
      throw new TypeError('skills/list returned an invalid skill descriptor')
    }
    return {
      name: skill['name'],
      description: skill['description'],
      modelInvocable: skill['modelInvocable'],
      source: skill['source'],
    }
  })
}
