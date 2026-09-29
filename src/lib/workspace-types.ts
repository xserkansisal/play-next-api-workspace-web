export type RequestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface KeyValueEntry {
  key: string
  value: string
  enabled: boolean
  description: string
}

export interface RequestBody {
  type: 'json'
  content: string
}

export interface RequestResource {
  id: string
  collectionId: string
  parentId: string | null
  type: 'request'
  name: string
  description: string
  method: RequestMethod
  url: string
  queryParams: KeyValueEntry[]
  headers: KeyValueEntry[]
  body: RequestBody | null
  auth: { type: 'none' }
  /** Email of the user who created/last modified this, or null for resources that predate sign-in. */
  createdBy?: string | null
  updatedBy?: string | null
}

export interface FolderResource {
  id: string
  collectionId: string
  parentId: string | null
  type: 'folder'
  name: string
  description: string
  items: WorkspaceItem[]
  createdBy?: string | null
  updatedBy?: string | null
}

export type WorkspaceItem = RequestResource | FolderResource
export type CreateItemInput =
  | (Omit<FolderResource, 'id' | 'collectionId' | 'parentId' | 'items'> & { parentId?: string })
  | (Omit<RequestResource, 'id' | 'collectionId' | 'parentId'> & { parentId?: string })

/** A node in the id-free tree accepted by `POST /api/v1/collections` (created atomically, one transaction). */
export type TreeNodeInput =
  | { type: 'request'; name: string; description: string; method: RequestMethod; url: string; queryParams: KeyValueEntry[]; headers: KeyValueEntry[]; body: RequestBody | null; auth: { type: 'none' } }
  | { type: 'folder'; name: string; description: string; items: TreeNodeInput[] }

export interface CollectionResource {
  id: string
  name: string
  description: string
  items: WorkspaceItem[]
  createdAt?: string
  updatedAt?: string
  createdBy?: string | null
  updatedBy?: string | null
}

export interface EnvironmentVariable {
  key: string
  value: string
  enabled: boolean
}

export interface EnvironmentResource {
  id: string
  name: string
  variables: EnvironmentVariable[]
  createdAt?: string
  updatedAt?: string
  createdBy?: string | null
  updatedBy?: string | null
}

export interface TrashEntry {
  id: string
  kind: 'collection' | 'folder' | 'request' | 'environment'
  name: string
  collectionId: string | null
  parentId: string | null
  deletedAt: string
}

export interface RestoreConflict {
  id: string
  name: string
  kind: 'collection' | 'folder' | 'environment'
  collectionId: string | null
  parentId: string | null
  conflictingId: string
}

export interface RestoreCheck {
  id: string
  kind: TrashEntry['kind']
  name: string
  canRestore: boolean
  blocker: { code: 'PARENT_IN_TRASH'; message: string } | null
  conflicts: RestoreConflict[]
}

export interface ChangeEvent {
  eventId: string
  kind: 'collection' | 'folder' | 'request' | 'environment'
  id: string
  collectionId: string | null
  operation: string
  changedAt: string
}

export type OpenResource =
  | { kind: 'collection'; collectionId: string }
  | { kind: 'folder'; collectionId: string; itemId: string }
  | { kind: 'request'; collectionId: string; itemId: string }
  | { kind: 'environment'; environmentId: string }

export type ResourceDraft =
  | { kind: 'collection'; resource: CollectionResource }
  | { kind: 'folder'; collectionId: string; resource: FolderResource }
  | { kind: 'request'; collectionId: string; parentId?: string; resource: RequestResource; isNew?: boolean }
  | { kind: 'environment'; resource: EnvironmentResource }

export function resourceKey(resource: OpenResource): string {
  return resource.kind === 'collection'
    ? `collection:${resource.collectionId}`
    : resource.kind === 'environment'
      ? `environment:${resource.environmentId}`
      : `${resource.kind}:${resource.collectionId}:${resource.itemId}`
}

export function isDraftDirty<T>(draft: T, saved: T): boolean {
  return JSON.stringify(draft) !== JSON.stringify(saved)
}

export function applyChangeEvent(
  event: ChangeEvent,
  current: OpenResource | null,
): 'review' | 'refresh' {
  if (!current) return 'refresh'
  if (current.kind === 'environment') {
    return event.kind === 'environment' && event.id === current.environmentId ? 'review' : 'refresh'
  }
  if (current.kind === 'collection') {
    return event.kind === 'collection' && event.id === current.collectionId ? 'review' : 'refresh'
  }
  return (event.kind === current.kind && event.id === current.itemId) ||
    (event.kind === 'collection' && event.id === current.collectionId)
    ? 'review'
    : 'refresh'
}

export function parseChangeEvent(
  type: string,
  data: string,
  // The API sends the sequence id only in the SSE `id:` field (exposed by the
  // browser as MessageEvent.lastEventId), never inside the JSON payload.
  lastEventId?: string,
): ChangeEvent | 'resync' | null {
  if (type === 'resync') return 'resync'
  if (type === 'ready' || type === 'open' || type === 'error' || type === 'heartbeat') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const value = parsed as Partial<ChangeEvent>
  if (
    (value.kind !== 'collection' && value.kind !== 'folder' && value.kind !== 'request' && value.kind !== 'environment') ||
    typeof value.id !== 'string' ||
    (value.collectionId !== null && typeof value.collectionId !== 'string') ||
    typeof value.operation !== 'string' ||
    typeof value.changedAt !== 'string'
  ) return null
  const eventId = typeof value.eventId === 'string' ? value.eventId : lastEventId
  if (typeof eventId !== 'string') return null
  return { ...value, eventId } as ChangeEvent
}
