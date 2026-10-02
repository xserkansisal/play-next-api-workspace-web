import type { CollectionResource, KeyValueEntry, WorkspaceItem } from '@/lib/workspace-types'
import { createUuid } from '@/lib/uuid'

/**
 * Serializes one of our collections as a Postman Collection v2.1 file.
 *
 * This is a best-effort, lossy export by design:
 * - Sibling order is not stored server-side; items are exported in the same alphabetical order
 *   the UI displays them in, which will not match whatever order they were originally created in.
 * - Every request is written with `auth: { type: "noauth" }` and no `event` (script) blocks,
 *   because that is the entirety of what our model supports.
 */
export function exportCollectionToPostman(collection: CollectionResource): Record<string, unknown> {
  return {
    info: {
      _postman_id: createUuid(),
      name: collection.name,
      description: collection.description || undefined,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: collection.items.map(convertItem),
  }
}

function convertItem(item: WorkspaceItem): Record<string, unknown> {
  if (item.type === 'folder') {
    return {
      name: item.name,
      description: item.description || undefined,
      item: item.items.map(convertItem),
    }
  }
  return {
    name: item.name,
    description: item.description || undefined,
    request: {
      method: item.method,
      header: item.headers.map(convertKeyValue),
      url: convertUrl(item.url, item.queryParams),
      body: item.body ? { mode: 'raw', raw: item.body.content, options: { raw: { language: 'json' } } } : undefined,
      auth: { type: 'noauth' },
    },
    response: [],
  }
}

function convertKeyValue(entry: KeyValueEntry): Record<string, unknown> {
  return { key: entry.key, value: entry.value, disabled: !entry.enabled, description: entry.description || undefined }
}

function convertUrl(url: string, queryParams: KeyValueEntry[]): Record<string, unknown> {
  const queryString = queryParams
    .filter((entry) => entry.enabled)
    .map((entry) => `${encodeURIComponent(entry.key)}=${encodeURIComponent(entry.value)}`)
    .join('&')
  const raw = queryString ? `${url}?${queryString}` : url

  const protocolMatch = /^([a-z][a-z0-9+.-]*):\/\//i.exec(url)
  const afterScheme = protocolMatch ? url.slice(protocolMatch[0].length) : url
  // A protocol-relative URL ("//host/path", used by one of our real test fixtures) has no
  // scheme but still uses the "//" network-path-reference prefix; strip it before splitting
  // host from path so the host segment isn't folded into path as an empty-then-literal "//".
  const withoutProtocol = !protocolMatch && afterScheme.startsWith('//') ? afterScheme.slice(2) : afterScheme
  const firstSlash = withoutProtocol.indexOf('/')
  const hostPart = firstSlash === -1 ? withoutProtocol : withoutProtocol.slice(0, firstSlash)
  const pathPart = firstSlash === -1 ? '' : withoutProtocol.slice(firstSlash + 1)

  // A templated host (e.g. "{{baseUrl}}") is kept as one segment, matching how real Postman
  // exports represent environment-driven hosts; a literal host is split on '.' per convention.
  const host = hostPart ? (hostPart.includes('{{') ? [hostPart] : hostPart.split('.')) : []
  const path = pathPart ? pathPart.split('/').filter(Boolean) : []

  return {
    raw,
    ...(protocolMatch ? { protocol: protocolMatch[1] } : {}),
    host,
    path,
    query: queryParams.map((entry) => ({ key: entry.key, value: entry.value, disabled: !entry.enabled, description: entry.description || undefined })),
  }
}
