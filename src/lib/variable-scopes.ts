/**
 * Where a `{{name}}` can be defined, and which definition wins.
 *
 * Three layers, highest first:
 *
 * 1. `user`  - captured by me, private to my account, follows me across tabs and machines.
 * 2. environment - the shared, exportable document the team edits by hand.
 * 3. `global` - shared by everyone, but not part of any environment.
 *
 * The narrowest layer wins because the whole point of capturing a value is to use *mine* instead
 * of the shared placeholder. If the shared one won, a captured token could never take effect.
 *
 * Environment sits *above* global deliberately, which is not the obvious "user, then global"
 * order. Postman resolves globals last, below the active environment, and these collections are
 * Postman imports - putting global on top would silently change what an imported request sends.
 */
export const VARIABLE_SCOPES = ['user', 'global'] as const
export type VariableScope = (typeof VARIABLE_SCOPES)[number]

/** Every layer a value can come from, including the one that is not a scoped variable. */
export type VariableOrigin = VariableScope | 'environment'

/** Highest priority first. The single source of the precedence rule. */
export const VARIABLE_PRECEDENCE: readonly VariableOrigin[] = ['user', 'environment', 'global']

export interface ScopedVariable {
  scope: VariableScope
  key: string
  value: string
  updatedAt?: string
  updatedBy?: string | null
}

export interface EnvironmentVariableLike {
  key: string
  value: string
  enabled: boolean
}

export interface VariableDefinition {
  key: string
  value: string
  enabled?: boolean
}

export interface VariableResolution {
  value: string
  /** The layer the value actually came from. */
  origin: VariableOrigin
  /**
   * Layers that define the same name but lost, highest first.
   *
   * Carried because silent shadowing is the known failure of any precedence chain: a personal
   * value saved last week keeps winning over a shared one a teammate has since corrected, and
   * without this the user has no way to see why.
   */
  shadowed: VariableOrigin[]
}

export function describeOrigin(origin: VariableOrigin): string {
  if (origin === 'user') return 'your variables'
  if (origin === 'global') return 'global variables'
  return 'the selected environment'
}

/**
 * Collapses the three layers into one lookup, recording what each name shadowed on the way.
 *
 * Disabled environment rows are skipped, matching how the environment editor already treats them:
 * an unticked row is not a definition at all, so it neither wins nor counts as shadowed.
 */
export function resolveVariables(
  scoped: readonly ScopedVariable[],
  environmentVariables: readonly EnvironmentVariableLike[] = [],
): Record<string, VariableResolution> {
  const byOrigin: Record<VariableOrigin, Map<string, string>> = {
    user: new Map(),
    environment: new Map(),
    global: new Map(),
  }
  for (const variable of scoped) {
    const layer = byOrigin[variable.scope]
    if (layer) layer.set(variable.key, variable.value)
  }
  for (const variable of environmentVariables) {
    if (!variable.enabled || !variable.key) continue
    byOrigin.environment.set(variable.key, variable.value)
  }

  const resolved: Record<string, VariableResolution> = {}
  const names = new Set<string>()
  for (const origin of VARIABLE_PRECEDENCE) for (const key of byOrigin[origin].keys()) names.add(key)

  for (const name of names) {
    const holders = VARIABLE_PRECEDENCE.filter((origin) => byOrigin[origin].has(name))
    const [winner, ...losers] = holders
    if (!winner) continue
    resolved[name] = { value: byOrigin[winner].get(name)!, origin: winner, shadowed: losers }
  }
  return resolved
}

/** The plain map the request preparer substitutes from. */
export function toVariableMap(resolved: Record<string, VariableResolution>): Record<string, string> {
  return Object.fromEntries(Object.entries(resolved).map(([name, entry]) => [name, entry.value]))
}

/** Names defined at more than one layer, so the UI can say so rather than leave it to be guessed. */
export function shadowedNames(resolved: Record<string, VariableResolution>): string[] {
  return Object.entries(resolved)
    .filter(([, entry]) => entry.shadowed.length > 0)
    .map(([name]) => name)
    .sort()
}

export type NameValidation = { ok: true; name: string } | { ok: false; error: string }

/**
 * Variable names are referenced as `{{name}}`, so anything that would break that reference
 * (empty, braces, whitespace) has to be rejected at entry rather than producing a variable that
 * can never be used. The API enforces the same rule; this only spares a round trip.
 */
export function validateVariableName(rawName: string): NameValidation {
  const name = rawName.trim()
  if (!name) return { ok: false, error: 'Enter a name for the variable.' }
  if (/[{}]/.test(name)) return { ok: false, error: 'A variable name cannot contain { or }.' }
  if (/\s/.test(name)) return { ok: false, error: 'A variable name cannot contain spaces.' }
  return { ok: true, name }
}
