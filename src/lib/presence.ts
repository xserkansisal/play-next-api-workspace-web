import { apiClient } from '@/lib/api'
import { resourceKey, type CollectionResource, type OpenResource, type WorkspaceItem } from '@/lib/workspace-types'

export type PresenceLocation =
  | { kind: 'collection'; collectionId: string }
  | { kind: 'folder' | 'request'; collectionId: string; itemId: string }

export interface PresenceUser {
  userId: string
  firstName?: string | null
  lastName?: string | null
  avatarUrl?: string | null
  avatarColor?: string | null
  location: PresenceLocation
}

export interface PresenceSnapshot {
  users: PresenceUser[]
}

const isSavedId = (id: string) => id !== '' && !id.startsWith('draft-')

/** Never-saved drafts carry a client-side `draft-…` id, which the server rejects with 400. */
export function presenceLocation(resource: OpenResource | null): PresenceLocation | null {
  if (!resource || resource.kind === 'environment') return null
  if (!isSavedId(resource.collectionId)) return null
  if (resource.kind === 'collection') return { kind: 'collection', collectionId: resource.collectionId }
  if (!isSavedId(resource.itemId)) return { kind: 'collection', collectionId: resource.collectionId }
  return { kind: resource.kind, collectionId: resource.collectionId, itemId: resource.itemId }
}

export function presenceResourceKey(location: PresenceLocation): string {
  return resourceKey(location)
}

export interface NestedPresence {
  user: PresenceUser
  /** Names from just below the ancestor row down to the resource the user is viewing. */
  path: string[]
}

/**
 * For every collection and folder, the users viewing something beneath it. Users already viewing
 * that row directly are left out so each person appears once per row.
 */
export function nestedPresenceByResource(
  collections: CollectionResource[],
  presenceByResource: Record<string, PresenceUser[]>,
): Record<string, NestedPresence[]> {
  const result: Record<string, NestedPresence[]> = {}

  const record = (key: string, found: NestedPresence[]) => {
    const direct = new Set((presenceByResource[key] ?? []).map(({ userId }) => userId))
    const seen = new Set<string>()
    const nested = found.filter(({ user }) => {
      if (direct.has(user.userId) || seen.has(user.userId)) return false
      seen.add(user.userId)
      return true
    })
    if (nested.length) result[key] = nested
  }

  const visit = (collectionId: string, item: WorkspaceItem): NestedPresence[] => {
    const key = resourceKey({ kind: item.type, collectionId, itemId: item.id })
    const below = item.type === 'folder'
      ? item.items.flatMap((child) => visit(collectionId, child))
      : []
    if (item.type === 'folder') record(key, below)
    const here = (presenceByResource[key] ?? []).map((user) => ({ user, path: [] as string[] }))
    return [...here, ...below].map(({ user, path }) => ({ user, path: [item.name, ...path] }))
  }

  for (const collection of collections) {
    const below = collection.items.flatMap((item) => visit(collection.id, item))
    record(resourceKey({ kind: 'collection', collectionId: collection.id }), below)
  }
  return result
}

export function parsePresenceSnapshot(data: string): PresenceSnapshot | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(data)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { users?: unknown }).users)) return null

  const users = (parsed as { users: unknown[] }).users.filter((entry): entry is PresenceUser => {
    if (!entry || typeof entry !== 'object') return false
    const user = entry as Partial<PresenceUser>
    if (typeof user.userId !== 'string' || !user.location || typeof user.location !== 'object') return false
    if (
      ![user.firstName, user.lastName, user.avatarUrl, user.avatarColor]
        .every((value) => value === undefined || value === null || typeof value === 'string')
    ) return false
    const location = user.location as Partial<PresenceLocation>
    return location.kind === 'collection'
      ? typeof location.collectionId === 'string'
      : (location.kind === 'folder' || location.kind === 'request') &&
        typeof location.collectionId === 'string' &&
        typeof location.itemId === 'string'
  })
  return { users }
}

export const presenceApi = {
  async heartbeat(clientId: string, location: PresenceLocation | null): Promise<void> {
    await apiClient.put('/presence', { clientId, location })
  },
}
