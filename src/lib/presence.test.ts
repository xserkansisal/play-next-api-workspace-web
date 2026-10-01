import { afterEach, describe, expect, it, vi } from 'vitest'

import { apiClient } from '@/lib/api'
import { parsePresenceSnapshot, presenceApi, presenceLocation, presenceResourceKey } from '@/lib/presence'

describe('workspace presence', () => {
  afterEach(() => vi.restoreAllMocks())

  it('maps only collections, folders, and requests to live locations', () => {
    expect(presenceLocation({ kind: 'collection', collectionId: 'c1' })).toEqual({
      kind: 'collection',
      collectionId: 'c1',
    })
    expect(presenceLocation({ kind: 'folder', collectionId: 'c1', itemId: 'f1' })).toEqual({
      kind: 'folder',
      collectionId: 'c1',
      itemId: 'f1',
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
})
