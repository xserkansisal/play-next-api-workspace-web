import type { EnvironmentResource, EnvironmentVariable } from '@/lib/workspace-types'
import { createUuid } from '@/lib/uuid'
import type { PostmanVariable } from '@/lib/postman-types'

/**
 * Import/export for Postman environment exports (`*.postman_environment.json`).
 *
 * A Postman environment is a different file shape from a collection: it has no `info`/`item`,
 * and instead carries `values[]` plus `_postman_variable_scope: "environment"`.
 */

// Mirrors environmentInputSchema in the API repo (src/validation/schemas.ts) so a plan built
// here is accepted rather than rejected server-side.
const MAX_NAME_LENGTH = 200
const MAX_VALUE_LENGTH = 8_192
const MAX_VARIABLES = 500
/** The API rejects keys containing whitespace or braces. */
const VALID_KEY = /^[^\s{}]+$/

export interface EnvironmentImportPlan {
  name: string
  variables: EnvironmentVariable[]
  /** Blocking problems; a plan with any error must not be sent to the API. */
  errors: string[]
  /** Non-blocking disclosures the user must see and acknowledge before continuing. */
  warnings: string[]
  /** Number of `values[]` entries in the file, before any were dropped. */
  sourceCount: number
}

export interface PostmanEnvironmentFile {
  id?: string
  name?: string
  values?: PostmanEnvironmentValue[]
  _postman_variable_scope?: string
  _postman_exported_at?: string
}

export interface PostmanEnvironmentValue extends PostmanVariable {
  /** Postman marks secrets as `"secret"`; everything else is `"default"`/`"text"`/absent. */
  type?: string
  enabled?: boolean
}

export type PostmanFileKind = 'collection' | 'environment' | 'globals' | 'unknown'

/**
 * Decides which importer a dropped file belongs to, so the UI can route it (and explain itself)
 * instead of running a collection parser over an environment file and reporting a confusing
 * "missing info/item" error.
 */
export function detectPostmanFileKind(raw: unknown): PostmanFileKind {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return 'unknown'
  const value = raw as Record<string, unknown>
  const scope = typeof value._postman_variable_scope === 'string' ? value._postman_variable_scope : ''
  if (scope === 'environment') return 'environment'
  if (scope === 'globals') return 'globals'
  if (value.info && typeof value.info === 'object' && Array.isArray(value.item)) return 'collection'
  // Some exporters (and hand-edited files) omit the scope marker. A `values[]` array with no
  // `item[]` is unambiguously an environment in practice.
  if (Array.isArray(value.values) && !Array.isArray(value.item)) return 'environment'
  return 'unknown'
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value
  if (value === null || value === undefined) return ''
  // Postman's UI only produces string values, but hand-edited and tool-generated files do carry
  // numbers/booleans. Those substitute perfectly well once stringified, so keep them.
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

export function parsePostmanEnvironment(raw: unknown): EnvironmentImportPlan {
  const errors: string[] = []
  const warnings: string[] = []
  const empty = (): EnvironmentImportPlan => ({ name: '', variables: [], errors, warnings, sourceCount: 0 })

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    errors.push('This file is not a recognizable Postman environment export (expected a JSON object).')
    return empty()
  }
  const file = raw as PostmanEnvironmentFile
  const kind = detectPostmanFileKind(raw)
  if (kind === 'collection') {
    errors.push('This is a Postman *collection* export, not an environment export. Use "Import collection" for this file.')
    return empty()
  }
  if (kind === 'globals') {
    errors.push('This is a Postman *globals* export. Globals are a Postman-wide scope with no equivalent here. Export the values as an environment in Postman instead, or create an Environment manually.')
    return empty()
  }
  if (!Array.isArray(file.values)) {
    errors.push('This file has no "values" array, which every Postman environment export has, so it cannot be imported.')
    return empty()
  }

  const rawName = typeof file.name === 'string' && file.name.trim() ? file.name.trim() : 'Imported environment'
  const name = truncate(rawName, MAX_NAME_LENGTH)
  if (name.length < rawName.length) warnings.push(`The environment name exceeded ${MAX_NAME_LENGTH} characters and was truncated.`)

  const sourceCount = file.values.length
  const variables: EnvironmentVariable[] = []
  const seen = new Map<string, number>()
  let secretsBlanked = 0
  let invalidKeys = 0
  let duplicates = 0
  let valuesTruncated = 0
  let emptyKeys = 0

  for (const entry of file.values) {
    if (!entry || typeof entry !== 'object') continue
    const key = typeof entry.key === 'string' ? entry.key.trim() : ''
    if (!key) {
      emptyKeys += 1
      continue
    }
    if (key.length > MAX_NAME_LENGTH || !VALID_KEY.test(key)) {
      invalidKeys += 1
      continue
    }
    if (seen.has(key)) {
      duplicates += 1
      continue
    }
    let value = textOf(entry.value)
    if (value.length > MAX_VALUE_LENGTH) {
      value = truncate(value, MAX_VALUE_LENGTH)
      valuesTruncated += 1
    }
    // Postman blanks out secret-typed values on export unless the user explicitly chose to
    // include them, so a `secret` with an empty value is almost always a withheld value rather
    // than a genuinely empty one.
    if (entry.type === 'secret' && value === '') secretsBlanked += 1
    seen.set(key, variables.length)
    variables.push({ key, value, enabled: entry.enabled !== false && entry.disabled !== true })
  }

  if (emptyKeys > 0) warnings.push(`${emptyKeys} value(s) had no key and were skipped.`)
  if (invalidKeys > 0) {
    warnings.push(`${invalidKeys} variable(s) had a key containing whitespace or braces, or longer than ${MAX_NAME_LENGTH} characters. Those keys cannot be referenced as {{name}} here and were skipped.`)
  }
  if (duplicates > 0) {
    warnings.push(`${duplicates} duplicate variable key(s) were found. Postman allows duplicates but this app does not, so only the first occurrence of each key was kept.`)
  }
  if (valuesTruncated > 0) warnings.push(`${valuesTruncated} value(s) exceeded ${MAX_VALUE_LENGTH} characters and were truncated.`)
  if (secretsBlanked > 0) {
    warnings.push(`${secretsBlanked} variable(s) are marked "secret" in Postman and were exported with an empty value. Postman withholds secret values unless they are explicitly included in the export, so these will import as blank and must be filled in by hand.`)
  }

  if (variables.length > MAX_VARIABLES) {
    errors.push(`This environment has ${variables.length} usable variables, over the ${MAX_VARIABLES} limit. Split it into multiple environments.`)
  }
  if (variables.length === 0 && errors.length === 0) {
    warnings.push('No usable variables were found in this file. An empty environment will be created.')
  }

  return { name, variables, errors, warnings, sourceCount }
}

/**
 * Serializes one of our environments as a Postman environment file.
 *
 * Lossy by design: this app has no "secret" variable type, so every value is exported as
 * `type: "default"` and its value is written out in clear text.
 */
export function exportEnvironmentToPostman(environment: EnvironmentResource): Record<string, unknown> {
  return {
    id: createUuid(),
    name: environment.name,
    values: environment.variables.map((variable) => ({
      key: variable.key,
      value: variable.value,
      type: 'default',
      enabled: variable.enabled,
    })),
    _postman_variable_scope: 'environment',
    _postman_exported_at: new Date().toISOString(),
    _postman_exported_using: 'Play Next API Workspace',
  }
}

/**
 * Builds an environment plan from a collection's own `variable[]` block, so collection-level
 * variables (which this app has no place to store) can optionally be kept as an environment
 * instead of being silently dropped.
 */
export function environmentFromCollectionVariables(
  collectionName: string,
  variables: PostmanVariable[] | undefined,
): EnvironmentImportPlan | null {
  if (!Array.isArray(variables) || variables.length === 0) return null
  return parsePostmanEnvironment({
    _postman_variable_scope: 'environment',
    name: truncate(`${collectionName} variables`, MAX_NAME_LENGTH),
    values: variables,
  })
}
