import { nameKey } from '@/lib/workspace-ui'
import type { KeyValueEntry, RequestMethod, TreeNodeInput } from '@/lib/workspace-types'
import type { PostmanBody, PostmanCollection, PostmanDescription, PostmanHeader, PostmanItem, PostmanUrl, PostmanVariable } from '@/lib/postman-types'

// Mirrors the API's validation/schemas.ts limits (src/validation/schemas.ts in the API repo) so
// that a plan built here is accepted rather than rejected by the server's own validation.
const MAX_NAME_LENGTH = 200
const MAX_DESCRIPTION_LENGTH = 10_000
const MAX_URL_LENGTH = 8_192
const MAX_ROWS = 500
const MAX_ROW_TEXT_LENGTH = 8_192
const MAX_BODY_LENGTH = 1_000_000
const MAX_TREE_DEPTH = 32
// The API's json body-parser limit is 50 MB (50 * 1024 * 1024 bytes) and nginx's
// client_max_body_size for /api/ is 50m; stay just under it to leave room for the JSON envelope.
export const MAX_TOTAL_PAYLOAD_BYTES = 50_000_000

const SUPPORTED_METHODS: readonly RequestMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

export interface ImportStats {
  folders: number
  requests: number
  requestsSkippedUnsupportedMethod: number
  bodiesDropped: number
  authDropped: number
  scriptsDropped: number
  foldersRenamedForCaseConflict: number
}

export interface ImportPlan {
  name: string
  description: string
  items: TreeNodeInput[]
  /** Blocking problems; a plan with any error must not be sent to the API. */
  errors: string[]
  /** Non-blocking disclosures the user must see and acknowledge before continuing. */
  warnings: string[]
  stats: ImportStats
  /** Approximate size in bytes of the JSON payload this plan would produce. */
  approxPayloadBytes: number
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value
}

function describeText(value: PostmanDescription): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && typeof value.content === 'string') return value.content
  return ''
}

function methodOf(value: unknown): RequestMethod | null {
  if (typeof value !== 'string') return null
  const upper = value.toUpperCase()
  return (SUPPORTED_METHODS as readonly string[]).includes(upper) ? (upper as RequestMethod) : null
}

/**
 * Splits a Postman URL (string or structured object) into a base URL (no query string) and a
 * query-param list, so query params land in our Params tab instead of being embedded as an
 * opaque string. Prefers the structured `url.query` array when present (it carries
 * enabled/disabled + description); otherwise the query string is parsed off the raw text.
 */
function convertUrl(url: string | PostmanUrl | undefined, warnings: string[], requestName: string): { url: string; queryParams: KeyValueEntry[] } {
  if (!url) return { url: '', queryParams: [] }
  if (typeof url === 'string') {
    const [base, query] = splitQuery(url)
    return { url: truncateUrl(base, warnings, requestName), queryParams: query }
  }
  const raw = url.raw ?? ''
  const [base] = splitQuery(raw)
  const queryParams = Array.isArray(url.query) && url.query.length > 0
    ? url.query.map((row) => keyValueOf(row))
    : splitQuery(raw)[1]
  return { url: truncateUrl(base, warnings, requestName), queryParams: capRows(queryParams, warnings, `${requestName} query params`) }
}

function truncateUrl(url: string, warnings: string[], requestName: string): string {
  if (url.length <= MAX_URL_LENGTH) return url
  warnings.push(`"${requestName}": the URL exceeded ${MAX_URL_LENGTH} characters and was truncated.`)
  return url.slice(0, MAX_URL_LENGTH)
}

function splitQuery(raw: string): [string, KeyValueEntry[]] {
  const markerIndex = raw.indexOf('?')
  if (markerIndex === -1) return [raw, []]
  const base = raw.slice(0, markerIndex)
  const queryString = raw.slice(markerIndex + 1)
  const entries: KeyValueEntry[] = []
  for (const pair of queryString.split('&')) {
    if (!pair) continue
    const eq = pair.indexOf('=')
    const rawKey = eq === -1 ? pair : pair.slice(0, eq)
    const rawValue = eq === -1 ? '' : pair.slice(eq + 1)
    try {
      entries.push({ key: decodeURIComponent(rawKey), value: decodeURIComponent(rawValue), enabled: true, description: '' })
    } catch {
      // Malformed percent-encoding: keep the literal text rather than dropping the param.
      entries.push({ key: rawKey, value: rawValue, enabled: true, description: '' })
    }
  }
  return [base, entries]
}

function keyValueOf(row: PostmanVariable | PostmanHeader): KeyValueEntry {
  return {
    key: truncate(row.key ?? '', MAX_ROW_TEXT_LENGTH),
    value: truncate(typeof row.value === 'string' ? row.value : row.value != null ? String(row.value) : '', MAX_ROW_TEXT_LENGTH),
    enabled: row.disabled !== true,
    description: truncate(describeText(row.description), MAX_DESCRIPTION_LENGTH),
  }
}

function capRows(rows: KeyValueEntry[], warnings: string[], label: string): KeyValueEntry[] {
  if (rows.length <= MAX_ROWS) return rows
  warnings.push(`"${label}" had more than ${MAX_ROWS} rows; extra rows beyond the limit were omitted.`)
  return rows.slice(0, MAX_ROWS)
}

function convertHeaders(request: PostmanRequestLike, warnings: string[], requestName: string): KeyValueEntry[] {
  // The canonical v2.1 key is "header" (singular); some real-world exporters/tools emit
  // "headers" (plural) instead. Accept either rather than silently losing header data.
  const raw = Array.isArray(request.header) ? request.header : Array.isArray(request.headers) ? request.headers : []
  return capRows(raw.map(keyValueOf), warnings, `${requestName} headers`)
}

interface PostmanRequestLike {
  method?: string
  header?: PostmanHeader[]
  headers?: PostmanHeader[]
  url?: string | PostmanUrl
  body?: PostmanBody | null
  auth?: { type?: string }
}

function convertBody(body: PostmanBody | null | undefined, warnings: string[], requestName: string, stats: ImportStats): { type: 'json'; content: string } | null {
  if (!body || !body.mode || body.mode === 'none') return null
  if (body.mode !== 'raw') {
    stats.bodiesDropped += 1
    warnings.push(`"${requestName}": a "${body.mode}" body is not supported (only raw/JSON bodies are); its body was not imported.`)
    return null
  }
  const content = body.raw ?? ''
  if (content.length > MAX_BODY_LENGTH) {
    warnings.push(`"${requestName}": the body exceeded ${MAX_BODY_LENGTH.toLocaleString()} characters and was truncated.`)
    return { type: 'json', content: content.slice(0, MAX_BODY_LENGTH) }
  }
  return { type: 'json', content }
}

function dedupeSiblingFolderName(name: string, seen: Map<string, number>, warnings: string[], parentLabel: string, stats: ImportStats): string {
  const key = nameKey(name)
  const count = seen.get(key) ?? 0
  seen.set(key, count + 1)
  if (count === 0) return name
  // A valid Postman file can contain sibling folders whose names differ only by case (e.g.
  // "Users" and "users"); our model requires active sibling folder names to be unique
  // case-insensitively. Rather than silently dropping one folder's whole subtree, we keep both
  // and disambiguate the later one with a numeric suffix, disclosed here.
  const renamed = `${name} (${count + 1})`
  stats.foldersRenamedForCaseConflict += 1
  warnings.push(`Renamed folder "${name}" to "${renamed}" under ${parentLabel} because a sibling folder had the same name (case-insensitively).`)
  return renamed
}

function convertNode(
  node: PostmanItem,
  depth: number,
  warnings: string[],
  stats: ImportStats,
  parentLabel: string,
  siblingFolderNames: Map<string, number>,
): TreeNodeInput | null {
  const rawName = typeof node.name === 'string' && node.name.trim() ? node.name : (Array.isArray(node.item) ? 'Untitled folder' : 'Untitled request')
  let name = truncate(rawName, MAX_NAME_LENGTH)
  if (name.length < rawName.length) warnings.push(`"${rawName}": the name exceeded ${MAX_NAME_LENGTH} characters and was truncated to "${name}".`)
  const description = truncate(describeText(node.description), MAX_DESCRIPTION_LENGTH)

  if (Array.isArray(node.event) && node.event.length > 0) stats.scriptsDropped += 1

  if (Array.isArray(node.item)) {
    // Folder ("item group"). Dedupe against already-seen siblings under the same parent.
    name = dedupeSiblingFolderName(name, siblingFolderNames, warnings, parentLabel, stats)
    if (depth >= MAX_TREE_DEPTH) {
      warnings.push(`"${name}": folder nesting exceeded the maximum depth of ${MAX_TREE_DEPTH}; its contents were omitted.`)
      stats.folders += 1
      return { type: 'folder', name, description, items: [] }
    }
    const childSeen = new Map<string, number>()
    const items = node.item
      .map((child) => convertNode(child, depth + 1, warnings, stats, name, childSeen))
      .filter((child): child is TreeNodeInput => child !== null)
    stats.folders += 1
    return { type: 'folder', name, description, items }
  }

  // Request leaf.
  const request = typeof node.request === 'object' && node.request ? node.request as PostmanRequestLike : {}
  const method = methodOf(request.method)
  if (!method) {
    stats.requestsSkippedUnsupportedMethod += 1
    warnings.push(`Skipped request "${name}": method "${String(request.method ?? '(missing)')}" is not supported (only GET, POST, PUT, PATCH, DELETE are).`)
    return null
  }
  const { url, queryParams } = convertUrl(request.url, warnings, name)
  const headers = convertHeaders(request, warnings, name)
  const body = convertBody(request.body, warnings, name, stats)
  if (request.auth && request.auth.type && request.auth.type !== 'noauth') {
    stats.authDropped += 1
    warnings.push(`"${name}": used "${request.auth.type}" authentication, which is not supported (No Auth only); its credentials were not imported.`)
  }
  stats.requests += 1
  return { type: 'request', name, description, method, url, queryParams, headers, body, auth: { type: 'none' } }
}

function payloadBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length
}

export function parsePostmanCollection(raw: unknown): ImportPlan {
  const stats: ImportStats = {
    folders: 0,
    requests: 0,
    requestsSkippedUnsupportedMethod: 0,
    bodiesDropped: 0,
    authDropped: 0,
    scriptsDropped: 0,
    foldersRenamedForCaseConflict: 0,
  }
  const warnings: string[] = []
  const errors: string[] = []

  if (!raw || typeof raw !== 'object') {
    errors.push('This file is not a recognizable Postman Collection v2.1 export (expected a JSON object).')
    return { name: '', description: '', items: [], errors, warnings, stats, approxPayloadBytes: 0 }
  }
  const collection = raw as PostmanCollection
  if (!collection.info || typeof collection.info !== 'object' || !Array.isArray(collection.item)) {
    errors.push('This file is missing the "info" object or "item" array that every Postman collection export has, so it cannot be imported.')
    return { name: '', description: '', items: [], errors, warnings, stats, approxPayloadBytes: 0 }
  }
  const schema = collection.info.schema ?? ''
  if (schema && !schema.includes('/v2.1.0/') && !schema.includes('/v2.0.0/')) {
    warnings.push(`This file declares schema "${schema}", not Postman Collection v2.1. Import will proceed on a best-effort basis and some data may not map correctly.`)
  } else if (schema && schema.includes('/v2.0.0/')) {
    warnings.push('This file is Postman Collection v2.0, not v2.1. The two formats are structurally very similar, so import proceeded, but this has not been validated against the v2.1 spec.')
  }

  const rawName = typeof collection.info.name === 'string' && collection.info.name.trim() ? collection.info.name.trim() : 'Imported collection'
  const name = truncate(rawName, MAX_NAME_LENGTH)
  if (name.length < rawName.length) warnings.push(`The collection name exceeded ${MAX_NAME_LENGTH} characters and was truncated.`)
  const description = truncate(describeText(collection.info.description), MAX_DESCRIPTION_LENGTH)

  if (Array.isArray(collection.event) && collection.event.length > 0) {
    warnings.push('This collection has collection-level pre-request/test scripts. Scripts are not supported by this app and were not imported.')
  }
  if (Array.isArray(collection.variable) && collection.variable.length > 0) {
    warnings.push(`This collection defines ${collection.variable.length} collection-level variable(s). Those are not imported as an Environment; create one manually in Environments if you need these values.`)
  }
  if (collection.auth && collection.auth.type && collection.auth.type !== 'noauth') {
    warnings.push(`This collection has a collection-level "${collection.auth.type}" auth default. Per-request auth other than No Auth is not supported and was not imported.`)
  }
  if (collection.protocolProfileBehavior) {
    warnings.push('This collection sets protocol profile behavior options (e.g. body-pruning rules). Those are Postman-runtime-specific and were not imported.')
  }

  const topSeen = new Map<string, number>()
  const items = collection.item
    .map((child) => convertNode(child, 1, warnings, stats, name, topSeen))
    .filter((child): child is TreeNodeInput => child !== null)

  if (items.length > 1) {
    // This app has no stored sibling order; the workspace always displays folders/requests
    // alphabetically. Postman preserves the file's explicit order, so that ordering is lost.
    warnings.push('Item order from this file is not preserved. This app always displays siblings alphabetically within each folder.')
  }

  if (stats.scriptsDropped > 0) {
    warnings.push(`${stats.scriptsDropped} folder/request item(s) had pre-request or test scripts. Scripts are not supported and were not imported.`)
  }

  const payload = { name, description, items }
  const approxPayloadBytes = payloadBytes(payload)
  if (approxPayloadBytes > MAX_TOTAL_PAYLOAD_BYTES) {
    errors.push(`This import would be about ${(approxPayloadBytes / 1_000_000).toFixed(1)} MB, over the ${(MAX_TOTAL_PAYLOAD_BYTES / 1_000_000).toFixed(1)} MB practical limit for a single import request. Split the collection and import it in parts.`)
  }

  return { name, description, items, errors, warnings, stats, approxPayloadBytes }
}
