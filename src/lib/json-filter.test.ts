import { describe, expect, it } from 'vitest'

import { extractVisible, filterJson } from '@/lib/json-filter'
import { buildRows } from '@/lib/json-tree'

const body = {
  status: 'ok',
  mathState: { totalWin: 100, rounds: 3 },
  items: [
    { id: 'a', win: 0 },
    { id: 'b', win: 250 },
    { id: 'c', win: 0 },
  ],
}

function labelsOf(value: unknown, visible: Set<string>, expanded: Set<string>) {
  return buildRows(value, { expanded, visible }).map((row) => row.label)
}

describe('filterJson', () => {
  it('returns null for a blank query, which is not the same as matching nothing', () => {
    expect(filterJson(body, '')).toBeNull()
    expect(filterJson(body, '   ')).toBeNull()
  })

  it('reports no matches for a query that finds nothing, rather than falling back to everything', () => {
    const result = filterJson(body, 'nowhere')!
    expect(result.matchCount).toBe(0)
    // Only the root survives, so the tree renders as an empty body instead of as nothing at all.
    expect([...result.visible]).toEqual([''])
  })

  it('matches a key', () => {
    const result = filterJson(body, 'mathstate')!
    expect(result.matchCount).toBe(1)
    expect(result.matches.has('\u0000mathState')).toBe(true)
  })

  it('is case-insensitive, since nobody remembers the casing of a field', () => {
    expect(filterJson(body, 'MATHSTATE')!.matchCount).toBe(1)
  })

  it('keeps the whole subtree of a matching key, or finding it would tell you nothing', () => {
    const result = filterJson(body, 'mathState')!
    expect(result.visible.has('\u0000mathState\u0000totalWin')).toBe(true)
    expect(result.visible.has('\u0000mathState\u0000rounds')).toBe(true)
  })

  it('keeps the ancestors of a match, which the match hangs from', () => {
    const result = filterJson(body, 'totalWin')!
    expect(result.visible.has('\u0000mathState')).toBe(true)
    expect(result.visible.has('')).toBe(true)
  })

  it('opens the ancestors, so a match is not hidden behind a collapsed branch', () => {
    const result = filterJson(body, 'totalWin')!
    expect(result.expand.has('\u0000mathState')).toBe(true)
    expect(result.expand.has('')).toBe(true)
  })

  it('drops the branches that hold no match', () => {
    const result = filterJson(body, 'totalWin')!
    expect(result.visible.has('\u0000items')).toBe(false)
    expect(result.visible.has('\u0000status')).toBe(false)
  })

  it('matches a value as it reads, not as JSON encodes it', () => {
    // The pretty-printed body shows "ok" in quotes; searching for a quote is nobody's intent.
    const result = filterJson(body, 'ok')!
    expect(result.matches.has('\u0000status')).toBe(true)
  })

  it('finds a number by the digits shown', () => {
    const result = filterJson(body, '250')!
    expect(result.matchCount).toBe(1)
    expect(result.matches.has('\u0000items\u00001\u0000win')).toBe(true)
  })

  it('finds null and booleans by name', () => {
    const value = { a: null, b: true }
    expect(filterJson(value, 'null')!.matches.has('\u0000a')).toBe(true)
    expect(filterJson(value, 'true')!.matches.has('\u0000b')).toBe(true)
  })

  it('does not count a matching container twice over its descendants', () => {
    // `mathState` matches by key; its two children must not be counted again as matches.
    expect(filterJson(body, 'mathState')!.matchCount).toBe(1)
  })

  it('counts each separate match', () => {
    expect(filterJson(body, 'win')!.matchCount).toBe(4)
  })
})

describe('filtering the rendered rows', () => {
  const expanded = new Set(['', '\u0000mathState', '\u0000items', '\u0000items\u00000', '\u0000items\u00001', '\u0000items\u00002'])

  it('shows only the path to the match', () => {
    const { visible } = filterJson(body, 'totalWin')!
    expect(labelsOf(body, visible, expanded)).toEqual([null, 'mathState', 'totalWin'])
  })

  it('keeps the real array index on a surviving entry, so its path still addresses the response', () => {
    const { visible } = filterJson(body, '250')!
    // Entries 0 and 2 are filtered out; the survivor is still items[1], not items[0].
    const rows = buildRows(body, { expanded, visible })
    const win = rows.find((row) => row.label === 'win')
    expect(win?.path).toBe('items[1].win')
  })

  it('reports the container size from the response, not from what survived the filter', () => {
    const { visible } = filterJson(body, '250')!
    const rows = buildRows(body, { expanded: new Set(['']), visible })
    const items = rows.find((row) => row.label === 'items')
    expect(items?.childCount).toBe(3)
  })
})

describe('extractVisible', () => {
  it('returns the whole body when everything is visible', () => {
    // 's' is in every top-level key, and a matching key brings its subtree with it.
    const { visible } = filterJson(body, 's')!
    expect(extractVisible(body, visible)).toEqual(body)
  })

  it('returns only the filtered part, as a document in its own right', () => {
    const { visible } = filterJson(body, 'totalWin')!
    expect(extractVisible(body, visible)).toEqual({ mathState: { totalWin: 100 } })
  })

  it('returns the whole subtree of a matched key', () => {
    const { visible } = filterJson(body, 'mathState')!
    expect(extractVisible(body, visible)).toEqual({ mathState: { totalWin: 100, rounds: 3 } })
  })

  it('closes the gaps in a filtered array, since a copied fragment must be valid JSON', () => {
    const { visible } = filterJson(body, '250')!
    // Unlike the tree, which keeps index 1 on the row, the copied array is renumbered: holes would
    // not be valid JSON and nulls would be a value the response never contained.
    expect(extractVisible(body, visible)).toEqual({ items: [{ win: 250 }] })
  })

  it('gives back an empty document when nothing matched', () => {
    const { visible } = filterJson(body, 'nowhere')!
    expect(extractVisible(body, visible)).toEqual({})
  })

  it('handles a primitive root', () => {
    const { visible } = filterJson('hello', 'ell')!
    expect(extractVisible('hello', visible)).toBe('hello')
  })

  it('handles an array root', () => {
    const value = [{ keep: 1 }, { drop: 2 }]
    const { visible } = filterJson(value, 'keep')!
    expect(extractVisible(value, visible)).toEqual([{ keep: 1 }])
  })
})
