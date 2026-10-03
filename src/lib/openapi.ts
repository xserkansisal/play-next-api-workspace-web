import type { BulkImportResult, ImportConflictPolicy } from '@/lib/api'
import type { CollectionResource, RequestMethod, RequestResource } from '@/lib/workspace-types'

/** The API rejects OpenAPI request bodies over 10 MiB, so larger files are refused before upload. */
export const MAX_OPENAPI_FILE_BYTES = 10 * 1024 * 1024
export const OPENAPI_FILE_ACCEPT = '.json,.yaml,.yml,application/json,application/yaml,application/x-yaml,text/yaml'

/**
 * The document as the user selected it. Kept as raw text so the backend does the parsing (one
 * validation story for JSON and YAML) and so a sync apply resubmits exactly what was previewed.
 */
export interface OpenApiSpecFile {
  fileName: string
  text: string
}

export type OpenApiWarning =
  | { code: 'UNSUPPORTED_METHOD'; method: string; path: string }
  | { code: 'MULTIPLE_TAGS'; path: string; method: string; usedTag: string }
  | { code: 'UNSUPPORTED_SECURITY'; path: string; method: string }
  | { code: 'UNSUPPORTED_PARAMETER'; path: string; method: string; parameter: string; location: string }
  | { code: 'SENSITIVE_PARAMETER_VALUE'; path: string; method: string; parameter: string; location: 'query' | 'header' }
  | { code: 'SENSITIVE_BODY_VALUE'; path: string; method: string }
  | { code: 'SENSITIVE_SERVER_URL'; path: string; method: string }
  | { code: 'UNSUPPORTED_BODY'; path: string; method: string; mediaType: string }

type BulkImportWarning = BulkImportResult['warnings'][number]

/** A one-time import reports conversion warnings and bulk-import header warnings in one list. */
export type OpenApiImportWarning = OpenApiWarning | BulkImportWarning

export interface OpenApiCreateInput {
  spec: string
  name?: string
  description?: string
}

export interface OpenApiCreateResult {
  collection: CollectionResource
  warnings: OpenApiWarning[]
}

export interface OpenApiImportInput {
  spec: string
  parentId: string | null
  onConflict: ImportConflictPolicy
  dryRun: boolean
}

export type OpenApiImportResult = Omit<BulkImportResult, 'warnings'> & { warnings: OpenApiImportWarning[] }

export interface OpenApiExportOptions {
  version: '3.1' | '3.0'
  format: 'json' | 'yaml'
}

export type OpenApiSyncChangeKind =
  | 'add'
  | 'adopt'
  | 'update'
  | 'move'
  | 'unchanged'
  | 'local-edit'
  | 'conflict'
  | 'delete'
  | 'delete-conflict'
  | 'missing'

export type OpenApiRequestFields = Pick<
  RequestResource,
  'name' | 'description' | 'method' | 'url' | 'queryParams' | 'headers' | 'body' | 'auth' | 'preRequestScript' | 'postResponseScript'
>

export interface OpenApiSyncChange {
  key: string
  kind: OpenApiSyncChangeKind
  method: RequestMethod
  path: string
  operationId?: string
  itemId?: string
  candidateItemIds?: string[]
  changedFields?: string[]
  before?: Partial<OpenApiRequestFields>
  after?: Partial<OpenApiRequestFields>
  recreatable?: boolean
  beforeFolderPath?: string[]
  afterFolderPath?: string[]
}

export interface OpenApiSyncPreview {
  collectionId: string
  linked: boolean
  source: { title: string; version: string }
  previewToken: string
  warnings: OpenApiWarning[]
  changes: OpenApiSyncChange[]
}

export type OpenApiConflictResolution = 'keep' | 'spec'

export interface OpenApiSyncApplyInput {
  spec: string
  previewToken: string
  adopt: Record<string, string>
  conflicts: Record<string, OpenApiConflictResolution>
  deleteItemIds: string[]
  recreate: string[]
}

export interface OpenApiSyncApplyResult {
  collectionId: string
  changedAt: string
  applied: {
    added: number
    adopted: number
    updated: number
    moved: number
    deleted: number
    recreated: number
  }
  pending: OpenApiSyncChange[]
  deletedItemIds: string[]
}

/** Only choices the user actually made. Anything absent falls back to the API's safe default. */
export interface OpenApiSyncDecisions {
  adopt: Record<string, string>
  conflicts: Record<string, OpenApiConflictResolution>
  deleteItemIds: string[]
  recreate: string[]
}

export const emptySyncDecisions = (): OpenApiSyncDecisions => ({ adopt: {}, conflicts: {}, deleteItemIds: [], recreate: [] })

export async function readOpenApiFile(file: File): Promise<OpenApiSpecFile> {
  if (!/\.(json|ya?ml)$/i.test(file.name)) {
    throw new Error('Choose an OpenAPI document saved as .json, .yaml, or .yml.')
  }
  if (file.size > MAX_OPENAPI_FILE_BYTES) {
    throw new Error('This file is larger than 10 MB, which is the most the API accepts for an OpenAPI document.')
  }
  const text = await file.text()
  if (!text.trim()) throw new Error('This file is empty.')
  return { fileName: file.name, text }
}

/** Reads `filename*` (RFC 5987) or `filename` from a Content-Disposition header. */
export function contentDispositionFileName(header: string | null | undefined): string | null {
  if (!header) return null
  const extended = /filename\*\s*=\s*(?:UTF-8|utf-8)''([^;]+)/.exec(header)
  if (extended) {
    try {
      return decodeURIComponent(extended[1]!.trim().replace(/^"|"$/g, ''))
    } catch {
      // Fall through to the plain filename parameter.
    }
  }
  const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/i.exec(header)
  const value = (plain?.[2] ?? plain?.[1])?.trim()
  return value || null
}

/** Mirrors the API's own export filename so a missing (unexposed) header still yields the same name. */
export function fallbackOpenApiFileName(collectionName: string, format: OpenApiExportOptions['format']): string {
  const safeName = collectionName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'collection'
  return `${safeName}-openapi.${format === 'yaml' ? 'yaml' : 'json'}`
}

function isOpenApiWarning(warning: OpenApiImportWarning): warning is OpenApiWarning {
  return typeof warning.path === 'string'
}

export function describeOpenApiWarning(warning: OpenApiImportWarning): string {
  if (!isOpenApiWarning(warning)) {
    const location = warning.path.join(' / ')
    return warning.header
      ? `${location}: the ${warning.header} header may contain a sensitive value. Review it before sending.`
      : `${location}: ${warning.code}`
  }
  const operation = `${warning.method.toUpperCase()} ${warning.path}`
  switch (warning.code) {
    case 'UNSUPPORTED_METHOD':
      return `${operation}: this HTTP method is not supported, so the operation was skipped.`
    case 'MULTIPLE_TAGS':
      return `${operation}: the operation has several tags. It was placed in the "${warning.usedTag}" folder (its first tag).`
    case 'UNSUPPORTED_SECURITY':
      return `${operation}: the security requirement cannot be represented. Set up this request's auth manually.`
    case 'UNSUPPORTED_PARAMETER':
      return `${operation}: the ${warning.location} parameter "${warning.parameter}" is not supported and was not imported.`
    case 'SENSITIVE_PARAMETER_VALUE':
      return `${operation}: the ${warning.location} parameter "${warning.parameter}" looks sensitive. Its value was not copied.`
    case 'SENSITIVE_BODY_VALUE':
      return `${operation}: sensitive values in the example body were replaced with placeholders.`
    case 'SENSITIVE_SERVER_URL':
      return `${operation}: credentials in the server URL were removed.`
    case 'UNSUPPORTED_BODY':
      return `${operation}: the "${warning.mediaType}" body type is not supported, so the request has no body.`
    default: {
      const unknown = warning as { code: string }
      return `${operation}: ${unknown.code}`
    }
  }
}

export function syncChangeLabel(change: Pick<OpenApiSyncChange, 'method' | 'path' | 'operationId'>): string {
  return `${change.method} ${change.path}${change.operationId ? ` · ${change.operationId}` : ''}`
}

/** Changes that the user must look at; `unchanged` rows are only listed for completeness. */
export function changesByKind(changes: OpenApiSyncChange[]) {
  const groups = new Map<OpenApiSyncChangeKind, OpenApiSyncChange[]>()
  for (const change of changes) {
    const list = groups.get(change.kind) ?? []
    list.push(change)
    groups.set(change.kind, list)
  }
  return groups
}

export function unresolvedConflictKeys(preview: OpenApiSyncPreview, decisions: OpenApiSyncDecisions): string[] {
  return preview.changes
    .filter((change) => change.kind === 'conflict' && !decisions.conflicts[change.key])
    .map((change) => change.key)
}

/** Whether a change offers the user an explicit "move to Trash / stop tracking" choice. */
export function canSelectForRemoval(change: OpenApiSyncChange): boolean {
  if (!change.itemId) return false
  if (change.kind === 'delete' || change.kind === 'delete-conflict') return true
  return change.kind === 'missing' && !change.recreatable
}

/**
 * Builds the apply body from the user's decisions, keeping only choices that are valid for this
 * preview. Stale or irrelevant entries are dropped rather than sent, since the API rejects any
 * choice that does not match the preview.
 */
export function buildSyncApplyInput(spec: string, preview: OpenApiSyncPreview, decisions: OpenApiSyncDecisions): OpenApiSyncApplyInput {
  const adopt: Record<string, string> = {}
  const conflicts: Record<string, OpenApiConflictResolution> = {}
  const deleteItemIds: string[] = []
  const recreate: string[] = []
  const selectedForRemoval = new Set(decisions.deleteItemIds)
  const selectedForRecreate = new Set(decisions.recreate)

  for (const change of preview.changes) {
    if (change.kind === 'adopt') {
      const candidate = decisions.adopt[change.key]
      if (candidate && change.candidateItemIds?.includes(candidate)) adopt[change.key] = candidate
    } else if (change.kind === 'conflict') {
      const resolution = decisions.conflicts[change.key]
      if (resolution) conflicts[change.key] = resolution
    } else if (change.kind === 'missing' && change.recreatable && selectedForRecreate.has(change.key)) {
      recreate.push(change.key)
    }
    if (canSelectForRemoval(change) && selectedForRemoval.has(change.itemId!) && !deleteItemIds.includes(change.itemId!)) {
      deleteItemIds.push(change.itemId!)
    }
  }
  return { spec, previewToken: preview.previewToken, adopt, conflicts, deleteItemIds, recreate }
}
