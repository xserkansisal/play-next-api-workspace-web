import { describe, expect, it } from 'vitest'

import { applyMove, checkMove } from '@/lib/tree-move'
import type { CollectionResource, WorkspaceItem } from '@/lib/workspace-types'

function folder(id: string, name: string, collectionId: string, parentId: string | null, items: WorkspaceItem[] = []): WorkspaceItem {
  return { id, collectionId, parentId, type: 'folder', name, description: '', items }
}

function request(id: string, name: string, collectionId: string, parentId: string | null): WorkspaceItem {
  return {
    id, collectionId, parentId, type: 'request', name, description: '',
    method: 'GET', url: '', queryParams: [], headers: [], body: null, auth: { type: 'none' },
  }
}

/**
 * c1: Outer > Inner > deep request, plus a loose request
 * c2: Other
 */
function tree(): CollectionResource[] {
  return [
    {
      id: 'c1', name: 'First', description: '', items: [
        folder('outer', 'Outer', 'c1', null, [
          folder('inner', 'Inner', 'c1', 'outer', [request('deep', 'Deep', 'c1', 'inner')]),
        ]),
        request('loose', 'Loose', 'c1', null),
      ],
    },
    { id: 'c2', name: 'Second', description: '', items: [folder('other', 'Other', 'c2', null)] },
  ]
}

function names(items: WorkspaceItem[]): string[] {
  return items.map((item) => item.name)
}

function find(collections: CollectionResource[], id: string): WorkspaceItem | undefined {
  const walk = (items: WorkspaceItem[]): WorkspaceItem | undefined => {
    for (const item of items) {
      if (item.id === id) return item
      if (item.type === 'folder') {
        const hit = walk(item.items)
        if (hit) return hit
      }
    }
    return undefined
  }
  for (const collection of collections) {
    const hit = walk(collection.items)
    if (hit) return hit
  }
  return undefined
}

describe('checkMove', () => {
  it('refuses to drop a folder into itself', () => {
    const result = checkMove(tree(), { collectionId: 'c1', itemId: 'outer' }, { kind: 'folder', collectionId: 'c1', itemId: 'outer' })
    expect(result).toMatchObject({ ok: false, reason: 'into-self' })
  })

  it('refuses to drop a folder into its own descendant, which would detach the subtree', () => {
    const result = checkMove(tree(), { collectionId: 'c1', itemId: 'outer' }, { kind: 'folder', collectionId: 'c1', itemId: 'inner' })
    expect(result).toMatchObject({ ok: false, reason: 'into-descendant' })
  })

  it('refuses a drop onto the parent the item already sits in', () => {
    const result = checkMove(tree(), { collectionId: 'c1', itemId: 'inner' }, { kind: 'folder', collectionId: 'c1', itemId: 'outer' })
    expect(result).toMatchObject({ ok: false, reason: 'same-parent' })
  })

  it('treats the collection root as the parent of a top-level item', () => {
    const result = checkMove(tree(), { collectionId: 'c1', itemId: 'loose' }, { kind: 'collection', collectionId: 'c1' })
    expect(result).toMatchObject({ ok: false, reason: 'same-parent' })
  })

  it('blocks a folder whose name already exists in the destination, case-insensitively', () => {
    const collections = tree()
    collections[1].items.push(folder('clash', 'inner', 'c2', null))
    const result = checkMove(collections, { collectionId: 'c1', itemId: 'inner' }, { kind: 'collection', collectionId: 'c2' })
    expect(result).toMatchObject({ ok: false, reason: 'name-taken' })
  })

  it('allows a request to keep a name that a sibling request already uses', () => {
    const collections = tree()
    collections[1].items.push(request('twin', 'Loose', 'c2', null))
    expect(checkMove(collections, { collectionId: 'c1', itemId: 'loose' }, { kind: 'collection', collectionId: 'c2' })).toEqual({ ok: true })
  })

  it('allows moving a folder into an unrelated folder in another collection', () => {
    expect(checkMove(tree(), { collectionId: 'c1', itemId: 'outer' }, { kind: 'folder', collectionId: 'c2', itemId: 'other' })).toEqual({ ok: true })
  })

  it('reports a vanished source rather than throwing', () => {
    expect(checkMove(tree(), { collectionId: 'c1', itemId: 'ghost' }, { kind: 'collection', collectionId: 'c2' }))
      .toMatchObject({ ok: false, reason: 'missing-source' })
  })

  it('reports a vanished destination rather than throwing', () => {
    expect(checkMove(tree(), { collectionId: 'c1', itemId: 'loose' }, { kind: 'folder', collectionId: 'c1', itemId: 'ghost' }))
      .toMatchObject({ ok: false, reason: 'missing-target' })
  })
})

describe('applyMove', () => {
  it('moves a folder with its whole subtree intact', () => {
    const next = applyMove(tree(), { collectionId: 'c1', itemId: 'inner' }, { kind: 'collection', collectionId: 'c1' })
    const inner = find(next, 'inner')
    expect(inner?.type === 'folder' && names(inner.items)).toEqual(['Deep'])
    expect(names(next[0].items).sort()).toEqual(['Inner', 'Loose', 'Outer'])
    expect(find(next, 'outer')).toMatchObject({ items: [] })
  })

  it('rewrites collectionId and parentId through the whole moved subtree', () => {
    const next = applyMove(tree(), { collectionId: 'c1', itemId: 'outer' }, { kind: 'folder', collectionId: 'c2', itemId: 'other' })
    expect(find(next, 'outer')).toMatchObject({ collectionId: 'c2', parentId: 'other' })
    expect(find(next, 'inner')).toMatchObject({ collectionId: 'c2', parentId: 'outer' })
    expect(find(next, 'deep')).toMatchObject({ collectionId: 'c2', parentId: 'inner' })
  })

  it('removes the node from its old collection when moving across collections', () => {
    const next = applyMove(tree(), { collectionId: 'c1', itemId: 'outer' }, { kind: 'collection', collectionId: 'c2' })
    expect(names(next[0].items)).toEqual(['Loose'])
    expect(names(next[1].items)).toEqual(['Other', 'Outer'])
  })

  it('does not leave a copy behind when moving within one collection', () => {
    const next = applyMove(tree(), { collectionId: 'c1', itemId: 'loose' }, { kind: 'folder', collectionId: 'c1', itemId: 'inner' })
    expect(names(next[0].items)).toEqual(['Outer'])
    const inner = find(next, 'inner')
    expect(inner?.type === 'folder' && names(inner.items).sort()).toEqual(['Deep', 'Loose'])
  })

  it('returns the tree untouched for a move that checkMove rejects', () => {
    const before = tree()
    expect(applyMove(before, { collectionId: 'c1', itemId: 'outer' }, { kind: 'folder', collectionId: 'c1', itemId: 'inner' })).toBe(before)
  })

  it('leaves collections that the move does not touch referentially identical', () => {
    const before = tree()
    const next = applyMove(before, { collectionId: 'c1', itemId: 'loose' }, { kind: 'folder', collectionId: 'c1', itemId: 'outer' })
    expect(next[1]).toBe(before[1])
  })
})
