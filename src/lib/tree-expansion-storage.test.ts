import { beforeEach, describe, expect, it, vi } from 'vitest'

import { loadCollapsedIds, pruneCollapsedIds, saveCollapsedIds } from '@/lib/tree-expansion-storage'

const KEY = 'play-next-api-workspace.collapsed-tree-nodes.v1'

describe('collapsed-node persistence', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  it('round-trips a collapsed set', () => {
    saveCollapsedIds(new Set(['a', 'b']))
    expect([...loadCollapsedIds()].sort()).toEqual(['a', 'b'])
  })

  it('starts with nothing collapsed when there is no saved state', () => {
    expect(loadCollapsedIds().size).toBe(0)
  })

  it('removes the key entirely once everything is expanded again', () => {
    saveCollapsedIds(new Set(['a']))
    saveCollapsedIds(new Set())
    expect(window.localStorage.getItem(KEY)).toBeNull()
    expect(loadCollapsedIds().size).toBe(0)
  })

  it('ignores corrupt or unexpected stored values instead of throwing', () => {
    for (const bad of ['not json', '{"a":1}', 'null', '123', '"text"']) {
      window.localStorage.setItem(KEY, bad)
      expect(loadCollapsedIds().size).toBe(0)
    }
  })

  it('keeps only string entries from a partly corrupt array', () => {
    window.localStorage.setItem(KEY, JSON.stringify(['a', 42, null, 'b']))
    expect([...loadCollapsedIds()].sort()).toEqual(['a', 'b'])
  })

  it('does not throw when storage is unavailable, e.g. private mode or over quota', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    expect(() => saveCollapsedIds(new Set(['a']))).not.toThrow()

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    expect(() => loadCollapsedIds()).not.toThrow()
    expect(loadCollapsedIds().size).toBe(0)
  })
})

describe('pruneCollapsedIds', () => {
  it('drops ids for nodes that no longer exist', () => {
    expect([...pruneCollapsedIds(new Set(['gone', 'here']), ['here'])]).toEqual(['here'])
  })

  it('leaves the set untouched while the tree is empty, which is also how a loading tree looks', () => {
    // Pruning here would erase the user's saved state before collections ever arrive.
    const saved = new Set(['a', 'b'])
    expect(pruneCollapsedIds(saved, [])).toBe(saved)
  })

  it('returns the same instance when nothing was removed, so it cannot cause a render loop', () => {
    const saved = new Set(['a'])
    expect(pruneCollapsedIds(saved, ['a', 'b'])).toBe(saved)
  })

  it('handles an empty collapsed set', () => {
    const empty = new Set<string>()
    expect(pruneCollapsedIds(empty, ['a'])).toBe(empty)
  })
})
