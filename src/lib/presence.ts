import { apiClient } from '@/lib/api'
import { resourceKey, type OpenResource } from '@/lib/workspace-types'

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

export function presenceLocation(resource: OpenResource | null): PresenceLocation | null {
  if (!resource || resource.kind === 'environment') return null
  if (resource.kind === 'collection') return { kind: 'collection', collectionId: resource.collectionId }
  return { kind: resource.kind, collectionId: resource.collectionId, itemId: resource.itemId }
}

export function presenceResourceKey(location: PresenceLocation): string {
  return resourceKey(location)
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
