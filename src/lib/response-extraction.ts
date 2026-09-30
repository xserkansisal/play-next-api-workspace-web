import { childPath, indexPath } from '@/lib/json-path'
import type { ExecutionSuccess } from '@/lib/request-runner'

// Extracting a value out of a response and storing it as a variable is the
// declarative, no-scripting answer to "use a value from one response in a
// later request's body". It deliberately covers only what chaining actually
// needs (read one value out of a JSON body, a header, or the status) rather
// than reimplementing a scripting sandbox.

export type ExtractionResult = { ok: true; value: string } | { ok: false; error: string }

const HEADER_PREFIX = 'header:'
const MAX_SUGGESTIONS = 200
const MAX_SUGGESTION_DEPTH = 6
/**
 * Runtime variables share one `sessionStorage` entry with a browser quota of roughly 5 MB, so an
 * unbounded capture could evict every other variable. Refusing with an explanatory error is better
 * than a silent partial write.
 */
const MAX_VALUE_LENGTH = 512 * 1024

type Segment = { kind: 'key'; name: string } | { kind: 'index'; index: number }

/**
 * Parses a dotted/bracketed path such as `data.items[0].id`, `["odd key"].x`
 * or `$.data.token`. Returns null when the path is malformed so the caller
 * can report it rather than silently extracting the wrong thing.
 */
export function parsePath(path: string): Segment[] | null {
  let rest = path.trim()
  if (!rest) return null
  if (rest.startsWith('$.')) rest = rest.slice(2)
  else if (rest === '$') return []

  const segments: Segment[] = []
  let expectKey = true

  while (rest.length > 0) {
    if (rest.startsWith('[')) {
      const end = rest.indexOf(']')
      if (end === -1) return null
      const inner = rest.slice(1, end).trim()
      if (/^\d+$/.test(inner)) {
        segments.push({ kind: 'index', index: Number(inner) })
      } else if (/^"[^"]*"$/.test(inner) || /^'[^']*'$/.test(inner)) {
        segments.push({ kind: 'key', name: inner.slice(1, -1) })
      } else {
        return null
      }
      rest = rest.slice(end + 1)
      expectKey = false
      continue
    }

    if (rest.startsWith('.')) {
      if (expectKey) return null
      rest = rest.slice(1)
      expectKey = true
      continue
    }

    if (!expectKey) return null
    const match = /^[^.[\]]+/.exec(rest)
    if (!match) return null
    segments.push({ kind: 'key', name: match[0] })
    rest = rest.slice(match[0].length)
    expectKey = false
  }

  if (expectKey) return null
  return segments
}

function describeSegments(segments: Segment[], upTo: number): string {
  let text = ''
  for (let index = 0; index < upTo; index += 1) {
    const segment = segments[index]
    if (segment.kind === 'index') text += `[${segment.index}]`
    else text += text ? `.${segment.name}` : segment.name
  }
  return text || '(root)'
}

function describeType(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  if (typeof value === 'object') return 'an object'
  return `a ${typeof value}`
}

/**
 * Converts a resolved JSON value to the string that will be substituted.
 *
 * Objects and arrays are serialised as JSON rather than rejected, because a whole object is
 * sometimes exactly what a later request needs - a game's `mathState` is passed back verbatim on
 * the next call. Substitution is plain text and body JSON is validated *after* substitution, so
 * `{"state": {{mathState}}}` produces a valid body.
 *
 * The quoted form `"{{mathState}}"` produces invalid JSON, which the existing post-substitution
 * validation reports with a line and column. That is left to fail rather than being silently
 * repaired: guessing that the user meant the unquoted form would change the request they wrote.
 */
function toVariableValue(value: unknown, path: string): ExtractionResult {
  if (typeof value === 'string') return { ok: true, value }
  if (typeof value === 'number' || typeof value === 'boolean') return { ok: true, value: String(value) }
  if (value === null) return { ok: false, error: `"${path}" is null in this response, so there is no value to store.` }
  if (value === undefined) return { ok: false, error: `"${path}" was not found in this response.` }

  let serialised: string
  try {
    serialised = JSON.stringify(value)
  } catch {
    // A cycle cannot occur in JSON.parse output, but a BigInt or similar from another source can.
    return { ok: false, error: `"${path}" is ${describeType(value)} that cannot be converted to JSON.` }
  }
  if (serialised === undefined) return { ok: false, error: `"${path}" has no JSON representation.` }
  if (serialised.length > MAX_VALUE_LENGTH) {
    return {
      ok: false,
      error: `"${path}" is ${describeType(value)} of ${serialised.length.toLocaleString()} characters, over the ` +
        `${MAX_VALUE_LENGTH.toLocaleString()} limit for a stored variable. Point at a smaller part of it, such as "${path}.id".`,
    }
  }
  return { ok: true, value: serialised }
}

export function extractFromResponse(path: string, response: ExecutionSuccess): ExtractionResult {
  const trimmed = path.trim()
  if (!trimmed) return { ok: false, error: 'Enter the path to the value you want to store.' }

  if (trimmed.toLowerCase().startsWith(HEADER_PREFIX)) {
    const name = trimmed.slice(HEADER_PREFIX.length).trim().toLowerCase()
    if (!name) return { ok: false, error: 'Enter a header name after "header:", for example "header:location".' }
    const found = Object.entries(response.headers).find(([key]) => key.toLowerCase() === name)
    if (!found) return { ok: false, error: `The response has no "${name}" header. Note the browser hides some headers unless the server exposes them via Access-Control-Expose-Headers.` }
    return { ok: true, value: found[1] }
  }

  if (trimmed.toLowerCase() === 'status') return { ok: true, value: String(response.status) }

  const segments = parsePath(trimmed)
  if (!segments) return { ok: false, error: `"${trimmed}" is not a valid path. Use a form like "data.token", "items[0].id" or "header:location".` }

  if (!response.bodyText.trim()) return { ok: false, error: 'The response body is empty.' }
  let parsed: unknown
  try {
    parsed = JSON.parse(response.bodyText)
  } catch {
    return { ok: false, error: 'The response body is not valid JSON, so a path cannot be read from it. Use "header:name" or "status" instead.' }
  }

  let current: unknown = parsed
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]
    const reached = describeSegments(segments, index)
    if (current === null || current === undefined) {
      return { ok: false, error: `"${reached}" is ${current === null ? 'null' : 'missing'}, so "${trimmed}" cannot be read.` }
    }
    if (segment.kind === 'index') {
      if (!Array.isArray(current)) return { ok: false, error: `"${reached}" is ${describeType(current)}, not an array, so [${segment.index}] does not apply.` }
      if (segment.index >= current.length) return { ok: false, error: `"${reached}" has ${current.length} item(s), so [${segment.index}] is out of range.` }
      current = current[segment.index]
      continue
    }
    if (typeof current !== 'object' || Array.isArray(current)) {
      return { ok: false, error: `"${reached}" is ${describeType(current)}, so "${segment.name}" cannot be read from it.` }
    }
    if (!Object.prototype.hasOwnProperty.call(current, segment.name)) {
      return { ok: false, error: `"${reached}" has no "${segment.name}" field.` }
    }
    current = (current as Record<string, unknown>)[segment.name]
  }

  return toVariableValue(current, trimmed)
}

/**
 * Lists the paths this response offers, so the UI can suggest them instead of making the user
 * guess the shape. Container paths are included as well as leaves, because a whole object is now a
 * capturable value, and `mathState` is not discoverable if only `mathState.version` is offered.
 */
export function suggestPaths(response: ExecutionSuccess): string[] {
  if (!response.bodyText.trim()) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(response.bodyText)
  } catch {
    return []
  }

  const paths: string[] = []
  const walk = (value: unknown, prefix: string, depth: number) => {
    if (paths.length >= MAX_SUGGESTIONS || depth > MAX_SUGGESTION_DEPTH) return
    if (Array.isArray(value)) {
      if (prefix) paths.push(prefix)
      value.slice(0, 3).forEach((entry, index) => walk(entry, indexPath(prefix, index), depth + 1))
      return
    }
    if (value !== null && typeof value === 'object') {
      if (prefix) paths.push(prefix)
      for (const [key, entry] of Object.entries(value)) {
        const next = childPath(prefix, key)
        // A key the path syntax cannot express is skipped rather than suggested in a form that
        // would fail to parse; the response tree reports the same value as unaddressable.
        if (next === null) continue
        walk(entry, next, depth + 1)
        if (paths.length >= MAX_SUGGESTIONS) return
      }
      return
    }
    if (prefix && value !== null) paths.push(prefix)
  }
  walk(parsed, '', 0)
  return paths
}
