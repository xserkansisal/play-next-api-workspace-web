import { afterEach, describe, expect, it, vi } from 'vitest'

import { apiClient } from '@/lib/api'
import type { CollectionResource } from '@/lib/workspace-types'
import { nestedPresenceByResource, parsePresenceSnapshot, presenceApi, presenceLocation, presenceResourceKey } from '@/lib/presence'

describe('workspace presence', () => {
  afterEach(() => vi.restoreAllMocks())

  it('maps only collections, folders, and requests to live locations', () => {
    const c = '123e4567-e89b-42d3-a456-426614174000'
    const f = '123e4567-e89b-42d3-a456-426614174001'
    expect(presenceLocation({ kind: 'collection', collectionId: c })).toEqual({ kind: 'collection', collectionId: c })
    expect(presenceLocation({ kind: 'folder', collectionId: c, itemId: f })).toEqual({
      kind: 'folder',
      collectionId: c,
      itemId: f,
    })
    // An unsaved draft has no server id yet, so it falls back to its collection.
    expect(presenceLocation({ kind: 'request', collectionId: c, itemId: `draft-${f}` })).toEqual({
      kind: 'collection',
      collectionId: c,
    })
    expect(presenceLocation({ kind: 'environment', environmentId: 'e1' })).toBeNull()
    expect(presenceResourceKey({ kind: 'request', collectionId: 'c1', itemId: 'r1' })).toBe('request:c1:r1')
  })

  it('parses snapshots and ignores malformed payloads or invalid locations', () => {
    const snapshot = {
      users: [{
        userId: 'u1',
        firstName: 'Ada',
        lastName: 'Lovelace',
        avatarUrl: null,
        avatarColor: 'violet',
        location: { kind: 'request', collectionId: 'c1', itemId: 'r1' },
      }],
    }
    expect(parsePresenceSnapshot(JSON.stringify(snapshot))).toEqual(snapshot)
    expect(parsePresenceSnapshot('{')).toBeNull()
    expect(parsePresenceSnapshot(JSON.stringify({ users: [{ userId: 'u1', location: { kind: 'request' } }] }))).toEqual({ users: [] })
  })

  it('sends a tab heartbeat with the current resource or null to clear it', async () => {
    const put = vi.spyOn(apiClient, 'put').mockResolvedValue({ data: {} })
    const location = { kind: 'request' as const, collectionId: 'c1', itemId: 'r1' }
    await presenceApi.heartbeat('tab-id', location)
    await presenceApi.heartbeat('tab-id', null)
    expect(put).toHaveBeenNthCalledWith(1, '/presence', { clientId: 'tab-id', location })
    expect(put).toHaveBeenNthCalledWith(2, '/presence', { clientId: 'tab-id', location: null })
  })

  it('rolls viewers up to every ancestor, preferring a direct view and listing each user once', () => {
    const base = { collectionId: 'c1', parentId: null, description: '' }
    const collections = [{
      id: 'c1', name: 'Payments', description: '',
      items: [{
        ...base, id: 'f1', type: 'folder', name: 'Orders',
        items: [
          { ...base, id: 'r1', type: 'request', name: 'Create' },
          { ...base, id: 'r2', type: 'request', name: 'List' },
        ],
      }],
    }] as unknown as CollectionResource[]
    const ayse = { userId: 'u1', firstName: 'Ayse', location: { kind: 'request', collectionId: 'c1', itemId: 'r1' } } as const
    const ayseOtherTab = { ...ayse, location: { kind: 'request', collectionId: 'c1', itemId: 'r2' } } as const
    const mehmet = { userId: 'u2', firstName: 'Mehmet', location: { kind: 'folder', collectionId: 'c1', itemId: 'f1' } } as const

    const nested = nestedPresenceByResource(collections, {
      'request:c1:r1': [ayse],
      'request:c1:r2': [ayseOtherTab],
      'folder:c1:f1': [mehmet],
    })

    expect(nested['folder:c1:f1']).toEqual([{ user: ayse, path: ['Create'] }])
    expect(nested['collection:c1']).toEqual([
      { user: mehmet, path: ['Orders'] },
      { user: ayse, path: ['Orders', 'Create'] },
    ])
    expect(nested['request:c1:r1']).toBeUndefined()
  })
})
