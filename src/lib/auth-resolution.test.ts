import { describe, expect, it } from 'vitest'

import { buildAuthAncestry, describeAuthSource, resolveEffectiveAuth } from '@/lib/auth-resolution'
import type { CollectionResource, FolderResource, RequestResource } from '@/lib/workspace-types'

function folder(id: string, name: string, items: FolderResource['items'], auth?: FolderResource['auth']): FolderResource {
  return { id, collectionId: 'col-1', parentId: null, type: 'folder', name, description: '', items, auth }
}

const collection: CollectionResource = {
  id: 'col-1',
  name: 'Production API',
  description: '',
  auth: { type: 'bearer', token: '{{productionToken}}' },
  items: [
    folder('folder-outer', 'Outer', [
      folder('folder-inner', 'Inner', [], { type: 'none' }),
      folder('folder-plain', 'Plain', []),
    ]),
  ],
}

describe('buildAuthAncestry', () => {
  it('returns just the collection when the parent is the root', () => {
    expect(buildAuthAncestry(collection, null)).toEqual([
      { kind: 'collection', id: 'col-1', name: 'Production API', auth: { type: 'bearer', token: '{{productionToken}}' } },
    ])
  })

  it('orders nested folders nearest-first, ending with the collection', () => {
    expect(buildAuthAncestry(collection, 'folder-inner')).toEqual([
      { kind: 'folder', id: 'folder-inner', name: 'Inner', auth: { type: 'none' } },
      { kind: 'folder', id: 'folder-outer', name: 'Outer', auth: null },
      { kind: 'collection', id: 'col-1', name: 'Production API', auth: { type: 'bearer', token: '{{productionToken}}' } },
    ])
  })

  it('treats a folder with no auth setting as null, not missing', () => {
    expect(buildAuthAncestry(collection, 'folder-plain')).toEqual([
      { kind: 'folder', id: 'folder-plain', name: 'Plain', auth: null },
      { kind: 'folder', id: 'folder-outer', name: 'Outer', auth: null },
      { kind: 'collection', id: 'col-1', name: 'Production API', auth: { type: 'bearer', token: '{{productionToken}}' } },
    ])
  })

  it('returns an empty chain for an unknown parentId', () => {
    // Defensive: a stale/dangling parentId should not throw, just resolve as if there were no
    // folder ancestors (the collection itself is always included separately by the caller).
    expect(buildAuthAncestry(collection, 'does-not-exist')).toEqual([
      { kind: 'collection', id: 'col-1', name: 'Production API', auth: { type: 'bearer', token: '{{productionToken}}' } },
    ])
  })
})

describe('resolveEffectiveAuth', () => {
  const ancestry = buildAuthAncestry(collection, 'folder-inner')

  it('a non-inherit setting always wins outright, ignoring ancestry', () => {
    expect(resolveEffectiveAuth({ type: 'bearer', token: 'own-token' }, ancestry)).toEqual({
      auth: { type: 'bearer', token: 'own-token' },
      source: 'own',
    })
  })

  it('inherit takes the nearest ancestor with a setting', () => {
    const result = resolveEffectiveAuth({ type: 'inherit' }, ancestry)
    expect(result.auth).toEqual({ type: 'none' })
    expect(result.source).toEqual({ kind: 'folder', id: 'folder-inner', name: 'Inner', auth: { type: 'none' } })
  })

  it('inherit skips an ancestor with no setting and keeps looking upward', () => {
    const outerOnlyAncestry = buildAuthAncestry(collection, 'folder-plain')
    const result = resolveEffectiveAuth({ type: 'inherit' }, outerOnlyAncestry)
    expect(result.auth).toEqual({ type: 'bearer', token: '{{productionToken}}' })
    expect(result.source).toMatchObject({ kind: 'collection', id: 'col-1' })
  })

  it('inherit falls back to none when nothing in the chain is configured', () => {
    const bareCollection: CollectionResource = { id: 'col-2', name: 'Bare', description: '', items: [] }
    const result = resolveEffectiveAuth({ type: 'inherit' }, buildAuthAncestry(bareCollection, null))
    expect(result).toEqual({ auth: { type: 'none' }, source: 'default' })
  })

  it('resolves a representative RequestResource end to end', () => {
    const request: RequestResource = {
      id: 'req-1',
      collectionId: 'col-1',
      parentId: 'folder-plain',
      type: 'request',
      name: 'List records',
      description: '',
      method: 'GET',
      url: 'https://api.example.test/records',
      queryParams: [],
      headers: [],
      body: null,
      auth: { type: 'inherit' },
    }
    const result = resolveEffectiveAuth(request.auth, buildAuthAncestry(collection, request.parentId))
    expect(result.auth).toEqual({ type: 'bearer', token: '{{productionToken}}' })
  })
})

describe('describeAuthSource', () => {
  it('describes each kind of source in plain language', () => {
    expect(describeAuthSource('own')).toBe('this request')
    expect(describeAuthSource('default')).toBe('no ancestor has authentication configured')
    expect(describeAuthSource({ kind: 'collection', id: 'col-1', name: 'Production API', auth: null })).toBe('collection "Production API"')
    expect(describeAuthSource({ kind: 'folder', id: 'folder-1', name: 'Public endpoints', auth: null })).toBe('folder "Public endpoints"')
  })
})
