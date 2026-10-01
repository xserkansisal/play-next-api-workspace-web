import { MAX_REQUEST_BODY_LENGTH, type AuthCredentials, type RequestMethod, type RequestResource } from '@/lib/workspace-types'
import type { PreparedRequest } from '@/lib/request-runner'
import { parseMultipartFields, parseUrlEncodedFields, serializeMultipart, serializeUrlEncodedFields } from '@/lib/request-body'

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

/**
 * Substitutes into a JSON body, escaping any value that lands inside a string literal.
 *
 * Plain substitution is wrong for a JSON body. `"Bearer {{token}}"` breaks the moment the token
 * contains a quote or a backslash, and `"{{mathState}}"` - the natural thing to type when editing
 * a JSON body, since every other value there is quoted - breaks whenever the variable holds an
 * object. Both produced a parser error naming a character position, with nothing to connect it to
 * the variable that caused it.
 *
 * Escaping resolves this without guessing intent, because each spelling now means what it looks
 * like: outside quotes the value is inserted as raw JSON, inside quotes it becomes a JSON string
 * containing that text. The quoted form is a real use case in its own right - some APIs take a
 * stringified JSON blob as a field.
 *
 * Context is read from the *template*, before substitution, so it reflects the quotes the author
 * wrote rather than any that appear inside a value.
 */
export function substituteIntoJson(text: string, variables: Record<string, string>): SubstitutionResult {
  const missing: string[] = []
  let out = ''
  let index = 0
  let inString = false

  while (index < text.length) {
    const char = text[index]

    if (inString) {
      if (char === '\\') {
        // An escape sequence is copied whole, so the escaped character is never mistaken for a
        // closing quote.
        out += text.slice(index, index + 2)
        index += 2
        continue
      }
      if (char === '"') {
        inString = false
        out += char
        index += 1
        continue
      }
    } else if (char === '"') {
      inString = true
      out += char
      index += 1
      continue
    }

    if (char === '{' && text[index + 1] === '{') {
      const end = text.indexOf('}}', index + 2)
      const rawName = end === -1 ? null : text.slice(index + 2, end)
      if (rawName !== null && !/[{}]/.test(rawName)) {
        const name = rawName.trim()
        if (Object.prototype.hasOwnProperty.call(variables, name)) {
          const value = variables[name]
          // `JSON.stringify` of a string yields a quoted, fully escaped literal; the surrounding
          // quotes are dropped because the author's own quotes are already in the output.
          out += inString ? JSON.stringify(value).slice(1, -1) : value
        } else {
          missing.push(name)
          out += text.slice(index, end + 2)
        }
        index = end + 2
        continue
      }
    }

    out += char
    index += 1
  }

  return { value: out, missing }
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
  | { ok: false; reason: 'invalid-body'; message: string }
  | { ok: false; reason: 'invalid-url'; message: string }

/**
 * Resolves environment variables, prepares the selected body format, and
 * builds the fetch-ready request the runner will send.
 *
 * Decisions baked in here (see the Slice 4 report for rationale):
 * - `{{variables}}` are resolved in the URL, query params, headers, AND the
 *   JSON body — not just the URL/port, because bodies legitimately reference
 *   environment values too.
 * - JSON and GraphQL body validation happens AFTER substitution, not before: a body can
 *   be invalid JSON before variables are resolved (that's expected and
 *   allowed while editing/saving) but must be valid once resolved, since
 *   that is the literal text that gets sent over the wire.
 * - Disabled query params/headers are dropped entirely, matching the
 *   editor's checkbox semantics.
 * - A body is only attached for methods that allow one; `fetch` rejects a
 *   body on GET.
 * - `effectiveAuth` is resolved by the caller (it depends on the collection/folder tree, which
 *   this function has no access to) and is applied here, after user-authored headers/params, so
 *   its `{{variables}}` are substituted the same way as everything else and so a Basic/Bearer
 *   value always wins over a stray manually-typed `Authorization` header rather than duplicating it.
 */
export function prepareRequest(
  resource: RequestResource,
  variables: Record<string, string>,
  effectiveAuth: AuthCredentials = { type: 'none' },
): PrepareOutcome {
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

  applyAuth(effectiveAuth, substitute, resolvedHeaders, resolvedParams)

  let bodyContent: string | null = null
  let contentType: string | null = null
  let bodyError: string | null = null
  let jsonError: JsonParseError | null = null

  if (resource.method !== 'GET' && resource.body) {
    const { type, content } = resource.body
    if (content.length > MAX_REQUEST_BODY_LENGTH) {
      bodyError = `Request body content exceeds the ${MAX_REQUEST_BODY_LENGTH.toLocaleString()} character limit.`
    } else {
      switch (type) {
      case 'json':
      case 'graphql': {
        const result = substituteIntoJson(content, variables)
        missing.push(...result.missing)
        bodyContent = result.value
        contentType = 'application/json'
        if (bodyContent !== '') {
          const parsed = parseJsonWithLocation(bodyContent)
          if (!parsed.ok) jsonError = parsed.error
        }
        break
      }
      case 'form-urlencoded': {
        const rows = parseUrlEncodedFields(content).map(({ key, value }) => ({
          key: substitute(key),
          value: substitute(value),
        }))
        bodyContent = serializeUrlEncodedFields(rows)
        contentType = 'application/x-www-form-urlencoded'
        break
      }
      case 'multipart': {
        const parsed = parseMultipartFields(content)
        if (!parsed.ok) {
          bodyError = parsed.message
          break
        }
        const fields = parsed.fields.map((field) => ({
          key: substitute(field.key),
          value: substitute(field.value),
          enabled: field.enabled,
        }))
        const boundary = `----PlayNextBoundary${crypto.randomUUID().replace(/-/g, '')}`
        const serialized = serializeMultipart(fields, boundary)
        if (!serialized.ok) {
          bodyError = serialized.message
          break
        }
        bodyContent = serialized.content
        contentType = `multipart/form-data; boundary=${boundary}`
        break
      }
      case 'raw':
        bodyContent = substitute(content)
        contentType = 'text/plain'
        break
      }
    }
  }

  if (missing.length > 0) {
    return { ok: false, reason: 'missing-variables', missing: [...new Set(missing)].sort() }
  }
  if (jsonError) return { ok: false, reason: 'invalid-json', error: jsonError }
  if (bodyError) return { ok: false, reason: 'invalid-body', message: bodyError }

  const finalUrl = appendQueryParams(url, resolvedParams)
  try {
    // eslint-disable-next-line no-new -- validates the URL is well-formed before handing it to fetch
    new URL(finalUrl)
  } catch {
    return { ok: false, reason: 'invalid-url', message: `"${finalUrl}" is not a valid absolute URL once variables are resolved.` }
  }

  const headers: [string, string][] = resolvedHeaders.map(({ key, value }) => [key, value])
  if (bodyContent !== null && contentType !== null) {
    const contentTypeHeaders = headers.filter(([key]) => key.toLowerCase() === 'content-type')
    const managedType = resource.body?.type !== 'raw' || contentTypeHeaders.length === 0
    if (managedType) {
      if (contentTypeHeaders.length > 0) {
        for (const header of contentTypeHeaders) header[1] = contentType
      } else {
        headers.push(['Content-Type', contentType])
      }
    }
  }

  return {
    ok: true,
    request: {
      method: resource.method as RequestMethod,
      url: finalUrl,
      headers,
      body: bodyContent,
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

/**
 * Mutates `headers`/`params` in place to add or overwrite whatever the resolved auth requires.
 * Runs before the missing-variable check, substituting credential fields through the same
 * `substitute()` the rest of the request uses, so an unresolved `{{variable}}` inside a token or
 * password is reported like any other missing variable instead of being sent as literal text.
 */
function applyAuth(
  auth: AuthCredentials,
  substitute: (text: string) => string,
  headers: { key: string; value: string }[],
  params: { key: string; value: string }[],
): void {
  function setHeader(name: string, value: string) {
    const existing = headers.filter((header) => header.key.toLowerCase() === name.toLowerCase())
    if (existing.length > 0) {
      for (const header of existing) header.value = value
    } else {
      headers.push({ key: name, value })
    }
  }

  function setParam(name: string, value: string) {
    const existing = params.find((param) => param.key === name)
    if (existing) {
      existing.value = value
    } else {
      params.push({ key: name, value })
    }
  }

  switch (auth.type) {
  case 'none':
    return
  case 'basic': {
    const username = substitute(auth.username)
    const password = substitute(auth.password)
    setHeader('Authorization', `Basic ${base64EncodeUtf8(`${username}:${password}`)}`)
    return
  }
  case 'bearer':
    setHeader('Authorization', `Bearer ${substitute(auth.token)}`)
    return
  case 'api-key': {
    const key = substitute(auth.key)
    const value = substitute(auth.value)
    if (auth.in === 'header') setHeader(key, value)
    else setParam(key, value)
    return
  }
  }
}

/**
 * `btoa()` only handles Latin1 text and throws on characters outside that range, but the API
 * contract requires `base64(UTF-8(username:password))`. This encodes to UTF-8 bytes first and
 * builds the binary string `btoa` expects from those bytes, so non-ASCII credentials round-trip
 * correctly.
 */
function base64EncodeUtf8(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}
