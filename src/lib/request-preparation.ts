import type { RequestMethod, RequestResource } from '@/lib/workspace-types'
import type { PreparedRequest } from '@/lib/request-runner'

const VARIABLE_PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g

export interface SubstitutionResult {
  value: string
  missing: string[]
}

/**
 * Replaces `{{name}}` references with the matching environment variable.
 * Unresolved references are left in place (so the caller can still show
 * where they occurred) and their names are collected in `missing`.
 */
export function substituteVariables(text: string, variables: Record<string, string>): SubstitutionResult {
  const missing: string[] = []
  const value = text.replace(VARIABLE_PATTERN, (match, rawName: string) => {
    const name = rawName.trim()
    if (Object.prototype.hasOwnProperty.call(variables, name)) return variables[name]
    missing.push(name)
    return match
  })
  return { value, missing }
}

export function buildVariableMap(variables: { key: string; value: string; enabled: boolean }[]): Record<string, string> {
  const map: Record<string, string> = {}
  for (const variable of variables) {
    if (variable.enabled && variable.key.trim()) map[variable.key] = variable.value
  }
  return map
}

export interface JsonParseError {
  message: string
  line: number
  column: number
}

/**
 * Parses JSON and, on failure, resolves the character offset V8/JSC error
 * messages report into a 1-based line/column for display next to the body.
 */
export function parseJsonWithLocation(text: string): { ok: true; value: unknown } | { ok: false; error: JsonParseError } {
  try {
    return { ok: true, value: JSON.parse(text) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // Modern V8 sometimes reports "... at position N (line L column C)" directly;
    // prefer that over recomputing from the position when both are present.
    const lineColumnMatch = /line (\d+) column (\d+)/.exec(message)
    if (lineColumnMatch) {
      return { ok: false, error: { message, line: Number(lineColumnMatch[1]), column: Number(lineColumnMatch[2]) } }
    }
    const positionMatch = /position (\d+)/.exec(message)
    if (!positionMatch) {
      return { ok: false, error: { message, line: 1, column: 1 } }
    }
    const offset = Number(positionMatch[1])
    const before = text.slice(0, offset)
    const line = before.split('\n').length
    const column = offset - before.lastIndexOf('\n')
    return { ok: false, error: { message, line, column } }
  }
}

export type PrepareOutcome =
  | { ok: true; request: PreparedRequest }
  | { ok: false; reason: 'missing-variables'; missing: string[] }
  | { ok: false; reason: 'invalid-json'; error: JsonParseError }
  | { ok: false; reason: 'invalid-url'; message: string }

/**
 * Resolves environment variables, validates the (post-substitution) JSON
 * body, and builds the fetch-ready request the runner will send.
 *
 * Decisions baked in here (see the Slice 4 report for rationale):
 * - `{{variables}}` are resolved in the URL, query params, headers, AND the
 *   JSON body — not just the URL/port, because bodies legitimately reference
 *   environment values too.
 * - JSON body validation happens AFTER substitution, not before: a body can
 *   be invalid JSON before variables are resolved (that's expected and
 *   allowed while editing/saving) but must be valid once resolved, since
 *   that is the literal text that gets sent over the wire.
 * - Disabled query params/headers are dropped entirely, matching the
 *   editor's checkbox semantics.
 * - A body is only attached for methods that allow one; `fetch` rejects a
 *   body on GET/HEAD.
 */
export function prepareRequest(resource: RequestResource, variables: Record<string, string>): PrepareOutcome {
  const missing: string[] = []

  const substitute = (text: string) => {
    const result = substituteVariables(text, variables)
    missing.push(...result.missing)
    return result.value
  }

  const url = substitute(resource.url)
  const enabledParams = resource.queryParams.filter((entry) => entry.enabled && entry.key.trim())
  const resolvedParams = enabledParams.map((entry) => ({ key: substitute(entry.key), value: substitute(entry.value) }))
  const enabledHeaders = resource.headers.filter((entry) => entry.enabled && entry.key.trim())
  const resolvedHeaders = enabledHeaders.map((entry) => ({ key: substitute(entry.key), value: substitute(entry.value) }))
  const resolvedBody = resource.body ? substitute(resource.body.content) : null

  if (missing.length > 0) {
    return { ok: false, reason: 'missing-variables', missing: [...new Set(missing)].sort() }
  }

  const trimmedBody = resolvedBody?.trim() ?? ''
  if (trimmedBody) {
    const parsed = parseJsonWithLocation(trimmedBody)
    if (!parsed.ok) {
      return { ok: false, reason: 'invalid-json', error: parsed.error }
    }
  }

  const finalUrl = appendQueryParams(url, resolvedParams)
  try {
    // eslint-disable-next-line no-new -- validates the URL is well-formed before handing it to fetch
    new URL(finalUrl)
  } catch {
    return { ok: false, reason: 'invalid-url', message: `"${finalUrl}" is not a valid absolute URL once variables are resolved.` }
  }

  const headers: [string, string][] = resolvedHeaders.map(({ key, value }) => [key, value])
  const allowsBody = resource.method !== 'GET'
  const body = allowsBody && trimmedBody ? resolvedBody : null
  if (body && !headers.some(([key]) => key.toLowerCase() === 'content-type')) {
    headers.push(['Content-Type', 'application/json'])
  }

  return {
    ok: true,
    request: {
      method: resource.method as RequestMethod,
      url: finalUrl,
      headers,
      body,
    },
  }
}

function appendQueryParams(url: string, params: { key: string; value: string }[]): string {
  if (params.length === 0) return url
  const search = new URLSearchParams()
  for (const { key, value } of params) search.append(key, value)
  const query = search.toString()
  if (!query) return url
  return `${url}${url.includes('?') ? '&' : '?'}${query}`
}
