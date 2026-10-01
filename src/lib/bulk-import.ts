import type { ImportConflictPolicy } from '@/lib/api'
import { MAX_REQUEST_BODY_LENGTH, type KeyValueEntry, type RequestBody, type RequestMethod, type TreeNodeInput } from '@/lib/workspace-types'

export const MAX_BULK_IMPORT_FILE_BYTES = 10 * 1024 * 1024
export const MAX_BULK_IMPORT_NODES = 2_000
export const MAX_BULK_IMPORT_DEPTH = 32

const SUPPORTED_BODY_TYPES: readonly RequestBody['type'][] = ['json', 'form-urlencoded', 'multipart', 'raw', 'graphql']

export interface ParsedBulkImport {
  items: TreeNodeInput[]
  onConflict: ImportConflictPolicy
  folders: number
  requests: number
  maxDepth: number
}

export class BulkImportFileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BulkImportFileError'
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function assertKeys(value: Record<string, unknown>, allowed: string[], label: string): void {
  const unexpected = Object.keys(value).find((key) => !allowed.includes(key))
  if (unexpected) throw new BulkImportFileError(`${label} contains unsupported field "${unexpected}".`)
}

function requiredString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string') throw new BulkImportFileError(`${label} must be text.`)
  if (value.length > maxLength) throw new BulkImportFileError(`${label} must be at most ${maxLength.toLocaleString()} characters.`)
  return value
}

function isRequestBodyType(value: unknown): value is RequestBody['type'] {
  return SUPPORTED_BODY_TYPES.some((type) => type === value)
}

function importName(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new BulkImportFileError(`${label} must be text.`)
  const name = value.trim()
  if (!name) throw new BulkImportFileError(`${label} cannot be empty.`)
  if (name.length > 200) throw new BulkImportFileError(`${label} must be at most 200 characters.`)
  return name
}

function parseRows(value: unknown, label: string): KeyValueEntry[] {
  if (!Array.isArray(value)) throw new BulkImportFileError(`${label} must be an array.`)
  if (value.length > 500) throw new BulkImportFileError(`${label} cannot contain more than 500 rows.`)
  return value.map((row, index) => {
    const rowLabel = `${label} row ${index + 1}`
    if (!isRecord(row)) throw new BulkImportFileError(`${rowLabel} must be an object.`)
    assertKeys(row, ['key', 'value', 'description', 'enabled'], rowLabel)
    const enabled = row.enabled === undefined ? true : row.enabled
    if (typeof enabled !== 'boolean') throw new BulkImportFileError(`${rowLabel} enabled must be true or false.`)
    return {
      key: requiredString(row.key, `${rowLabel} key`, 8_192),
      value: requiredString(row.value, `${rowLabel} value`, 8_192),
      description: row.description === undefined ? '' : requiredString(row.description, `${rowLabel} description`, 10_000),
      enabled,
    }
  })
}

function measureTree(items: unknown[]): { nodes: number; maxDepth: number } {
  let nodes = 0
  let maxDepth = 0
  const stack: Array<{ items: unknown[]; depth: number }> = [{ items, depth: 1 }]
  while (stack.length > 0) {
    const current = stack.pop()!
    if (current.items.length === 0) continue
    nodes += current.items.length
    maxDepth = Math.max(maxDepth, current.depth)
    if (nodes > MAX_BULK_IMPORT_NODES) {
      throw new BulkImportFileError(`An import may contain at most ${MAX_BULK_IMPORT_NODES.toLocaleString()} items.`)
    }
    if (current.depth > MAX_BULK_IMPORT_DEPTH) {
      throw new BulkImportFileError(`Folders may be nested at most ${MAX_BULK_IMPORT_DEPTH} levels deep.`)
    }
    for (const item of current.items) {
      if (isRecord(item) && Array.isArray(item.items)) stack.push({ items: item.items, depth: current.depth + 1 })
    }
  }
  return { nodes, maxDepth }
}

function parseNodes(rawItems: unknown[], checkFolderNameConflicts = true): { items: TreeNodeInput[]; folders: number; requests: number } {
  const folderNames = new Set<string>()
  let folders = 0
  let requests = 0
  const items = rawItems.map((raw, index) => {
    const label = `Item ${index + 1}`
    if (!isRecord(raw)) throw new BulkImportFileError(`${label} must be an object.`)
    if (raw.type === 'folder') {
      assertKeys(raw, ['type', 'name', 'description', 'items'], label)
      const name = importName(raw.name, `${label} name`)
      const key = name.normalize('NFC').toLowerCase()
      if (checkFolderNameConflicts) {
        if (folderNames.has(key)) throw new BulkImportFileError(`Sibling folders cannot share the name "${name}".`)
        folderNames.add(key)
      }
      const description = raw.description === undefined ? '' : requiredString(raw.description, `${label} description`, 10_000)
      const children = raw.items === undefined ? [] : raw.items
      if (!Array.isArray(children)) throw new BulkImportFileError(`${label} items must be an array.`)
      const parsed = parseNodes(children)
      folders += 1 + parsed.folders
      requests += parsed.requests
      return { type: 'folder', name, description, items: parsed.items } as TreeNodeInput
    }
    if (raw.type !== 'request') throw new BulkImportFileError(`${label} type must be "folder" or "request".`)
    assertKeys(raw, ['type', 'name', 'description', 'method', 'url', 'queryParams', 'headers', 'body', 'auth'], label)
    const name = importName(raw.name, `${label} name`)
    const methods: readonly RequestMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
    if (typeof raw.method !== 'string' || !methods.includes(raw.method as RequestMethod)) {
      throw new BulkImportFileError(`${label} method must be GET, POST, PUT, PATCH, or DELETE.`)
    }
    const url = requiredString(raw.url, `${label} URL`, 8_192)
    const description = raw.description === undefined ? '' : requiredString(raw.description, `${label} description`, 10_000)
    const queryParams = raw.queryParams === undefined ? [] : parseRows(raw.queryParams, `${label} query params`)
    const headers = raw.headers === undefined ? [] : parseRows(raw.headers, `${label} headers`)
    let body: RequestBody | null = null
    if (raw.body !== undefined && raw.body !== null) {
      if (!isRecord(raw.body)) throw new BulkImportFileError(`${label} body must be null or a request body object.`)
      assertKeys(raw.body, ['type', 'content'], `${label} body`)
      if (!isRequestBodyType(raw.body.type)) {
        throw new BulkImportFileError(`${label} body type must be json, form-urlencoded, multipart, raw, or graphql.`)
      }
      body = {
        type: raw.body.type,
        content: requiredString(raw.body.content, `${label} body content`, MAX_REQUEST_BODY_LENGTH),
      }
    }
    if (raw.auth !== undefined) {
      if (!isRecord(raw.auth)) throw new BulkImportFileError(`${label} auth must be { "type": "none" }.`)
      assertKeys(raw.auth, ['type'], `${label} auth`)
      if (raw.auth.type !== 'none') throw new BulkImportFileError(`${label} auth type must be "none".`)
    }
    requests += 1
    return { type: 'request', name, description, method: raw.method as RequestMethod, url, queryParams, headers, body, auth: { type: 'none' } } as TreeNodeInput
  })
  return { items, folders, requests }
}

export function parseBulkImportFile(text: string): ParsedBulkImport {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new BulkImportFileError('This file is not valid JSON.')
  }
  if (!isRecord(parsed)) throw new BulkImportFileError('A bulk import file must be a JSON object.')
  assertKeys(parsed, ['onConflict', 'items', 'parentId', 'dryRun'], 'The bulk import file')
  if (!Array.isArray(parsed.items) || parsed.items.length === 0) {
    throw new BulkImportFileError('The file must contain at least one item in its "items" array.')
  }
  if (parsed.onConflict !== undefined && parsed.onConflict !== 'rename' && parsed.onConflict !== 'fail') {
    throw new BulkImportFileError('onConflict must be "rename" or "fail".')
  }
  if (parsed.parentId !== undefined && parsed.parentId !== null &&
      (typeof parsed.parentId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(parsed.parentId))) {
    throw new BulkImportFileError('parentId must be a UUID or null.')
  }
  if (parsed.dryRun !== undefined && typeof parsed.dryRun !== 'boolean') {
    throw new BulkImportFileError('dryRun must be true or false.')
  }
  const { nodes, maxDepth } = measureTree(parsed.items)
  if (nodes === 0) throw new BulkImportFileError('The file must contain at least one item in its "items" array.')
  const result = parseNodes(parsed.items, false)
  return { ...result, onConflict: (parsed.onConflict as ImportConflictPolicy | undefined) ?? 'rename', maxDepth }
}

export function validateBulkImportFileSize(size: number): void {
  if (size >= MAX_BULK_IMPORT_FILE_BYTES) throw new BulkImportFileError('Bulk import files must be smaller than 10 MB.')
}

export function validateBulkImportDestinationDepth(destinationDepth: number, importDepth: number): void {
  if (destinationDepth + importDepth > MAX_BULK_IMPORT_DEPTH) {
    throw new BulkImportFileError(`This import would exceed the maximum depth of ${MAX_BULK_IMPORT_DEPTH} levels at the selected destination.`)
  }
}

export type { ImportConflictPolicy }
