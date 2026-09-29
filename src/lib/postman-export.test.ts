import { describe, expect, it } from 'vitest'

import { parsePostmanCollection } from '@/lib/postman-import'
import { exportCollectionToPostman } from '@/lib/postman-export'
import type { CollectionResource, WorkspaceItem } from '@/lib/workspace-types'

const collection: CollectionResource = {
  id: 'col-1',
  name: 'Demo',
  description: 'A demo collection',
  items: [
    {
      id: 'folder-1',
      collectionId: 'col-1',
      parentId: null,
      type: 'folder',
      name: 'Users',
      description: '',
      items: [
        {
          id: 'req-1',
          collectionId: 'col-1',
          parentId: 'folder-1',
          type: 'request',
          name: 'Create user',
          description: '',
          method: 'POST',
          url: '{{baseUrl}}/users',
          queryParams: [],
          headers: [{ key: 'Content-Type', value: 'application/json', enabled: true, description: '' }],
          body: { type: 'json', content: '{"name":"{{name}}"}' },
          auth: { type: 'none' },
        },
      ],
    },
    {
      id: 'req-2',
      collectionId: 'col-1',
      parentId: null,
      type: 'request',
      name: 'List users',
      description: '',
      method: 'GET',
      url: '{{baseUrl}}/users',
      queryParams: [{ key: 'limit', value: '10', enabled: true, description: '' }],
      headers: [],
      body: null,
      auth: { type: 'none' },
    },
  ],
}

function flatten(items: WorkspaceItem[]): WorkspaceItem[] {
  return items.flatMap((item) => (item.type === 'folder' ? [item, ...flatten(item.items)] : [item]))
}

describe('exportCollectionToPostman', () => {
  it('produces a Postman v2.1-shaped file with the collection name, nested folder, and requests', () => {
    const exported = exportCollectionToPostman(collection) as { info: { name: string; schema: string }; item: unknown[] }
    expect(exported.info.name).toBe('Demo')
    expect(exported.info.schema).toContain('v2.1.0')
    expect(exported.item).toHaveLength(2)
  })

  it('round-trips supported data through export -> import with only ordering lost', () => {
    const exported = exportCollectionToPostman(collection)
    const plan = parsePostmanCollection(exported)
    expect(plan.errors).toEqual([])
    expect(plan.name).toBe(collection.name)

    const originalItems = flatten(collection.items)
    const importedItems = flatten(plan.items as unknown as WorkspaceItem[])
    expect(importedItems).toHaveLength(originalItems.length)

    const originalRequests = originalItems.filter((item): item is Extract<WorkspaceItem, { type: 'request' }> => item.type === 'request')
    const importedRequests = importedItems.filter((item): item is Extract<WorkspaceItem, { type: 'request' }> => item.type === 'request')
    for (const original of originalRequests) {
      const match = importedRequests.find((item) => item.name === original.name)
      expect(match).toBeDefined()
      expect(match?.method).toBe(original.method)
      expect(match?.url).toBe(original.url)
      expect(match?.body).toEqual(original.body)
      expect(match?.queryParams.map((entry) => [entry.key, entry.value])).toEqual(
        original.queryParams.map((entry) => [entry.key, entry.value]),
      )
      // auth is always exported/imported as none: our model has no other auth type to lose.
      expect(match?.auth).toEqual({ type: 'none' })
    }

    // Only the ordering-loss warning (and nothing else) is expected for this fully-supported input.
    expect(plan.warnings.every((warning) => warning.toLowerCase().includes('order'))).toBe(true)
  })
})
