import { describe, expect, it } from 'vitest'

import { childPath, indexPath } from '@/lib/json-path'
import { parsePath } from '@/lib/response-extraction'
import {
  allContainerIds,
  buildRows,
  countNodes,
  defaultExpanded,
  formatPrimitive,
  kindOf,
  summarise,
} from '@/lib/json-tree'

const expandAll = (value: unknown) => allContainerIds(value)!

describe('childPath', () => {
  it('builds paths the extraction parser actually accepts', () => {
    // The tree shows these so they can be pasted into "Value path". If the parser disagreed with
    // the builder the pasted path would silently miss, so agreement is asserted directly.
    const cases: [string, string][] = [
      [childPath('', 'data')!, 'data'],
      [childPath('data', 'token')!, 'data.token'],
      [childPath('data', 'odd key')!, 'data["odd key"]'],
      [childPath('data', '0')!, 'data["0"]'],
      [childPath('data', 'with.dot')!, 'data["with.dot"]'],
    ]
    for (const [built, expected] of cases) {
      expect(built).toBe(expected)
      expect(parsePath(built)).not.toBeNull()
    }
    expect(parsePath(indexPath('items', 2))).not.toBeNull()
  })

  it('returns null for keys the path syntax cannot express, instead of an unparseable path', () => {
    // parsePath reads a bracketed key with /^"[^"]*"$/ and finds the closing bracket with the
    // first ']', understanding no escapes. These keys have no representation at all.
    expect(childPath('data', 'has"quote')).toBeNull()
    expect(childPath('data', 'has]bracket')).toBeNull()
  })
})

describe('buildRows', () => {
  const body = { id: 1, nested: { deep: { value: 'x' } }, items: [10, 20] }

  it('shows only the root when nothing is expanded', () => {
    const rows = buildRows(body, { expanded: new Set() })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ depth: 0, kind: 'object', childCount: 3, expanded: false })
  })

  it('costs nothing for a collapsed branch, which is the point of collapsing', () => {
    const rows = buildRows(body, { expanded: new Set(['']) })
    expect(rows.map((row) => row.label)).toEqual([null, 'id', 'nested', 'items'])
  })

  it('addresses each row with a path that resolves back to the same value', () => {
    const rows = buildRows(body, { expanded: expandAll(body) })
    const byPath = Object.fromEntries(rows.filter((row) => row.path).map((row) => [row.path, row.value]))
    expect(byPath['nested.deep.value']).toBe('x')
    expect(byPath['items[1]']).toBe(20)
  })

  it('numbers array rows by their real index even when the container is capped', () => {
    const value = { items: Array.from({ length: 5 }, (_, index) => index) }
    const rows = buildRows(value, { expanded: expandAll(value), childrenPerContainer: 3 })
    const shown = rows.filter((row) => row.path?.startsWith('items['))
    expect(shown.map((row) => row.path)).toEqual(['items[0]', 'items[1]', 'items[2]'])
    expect(shown.map((row) => row.value)).toEqual([0, 1, 2])
  })

  it('accounts for every hidden child rather than dropping them silently', () => {
    const value = { items: Array.from({ length: 5 }, (_, index) => index) }
    const rows = buildRows(value, { expanded: expandAll(value), childrenPerContainer: 3 })
    const more = rows.find((row) => row.hiddenCount !== undefined)
    expect(more?.hiddenCount).toBe(2)
  })

  it('lifts the cap only for the container the user revealed', () => {
    const value = { a: [1, 2, 3], b: [4, 5, 6] }
    const rows = buildRows(value, {
      expanded: expandAll(value),
      revealed: new Set(['\u0000a']),
      childrenPerContainer: 2,
    })
    expect(rows.filter((row) => row.path?.startsWith('a[')).length).toBe(3)
    expect(rows.filter((row) => row.path?.startsWith('b[')).length).toBe(2)
  })

  it('marks a value under an unaddressable key as having no path, and keeps it visible', () => {
    const value = { 'has"quote': { inner: 1 } }
    const rows = buildRows(value, { expanded: expandAll(value) })
    const labels = rows.map((row) => row.label)
    expect(labels).toContain('has"quote')
    expect(labels).toContain('inner')
    // Visible, but not offered as something that can be captured by path.
    expect(rows.find((row) => row.label === 'inner')?.path).toBeNull()
  })

  it('gives every row a distinct id even when keys collide with array indices', () => {
    const value = { '0': 'a', items: ['b'] }
    const rows = buildRows(value, { expanded: expandAll(value) })
    expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length)
  })

  it('renders an empty container without claiming it has children', () => {
    const value = { empty: {}, none: [] }
    const rows = buildRows(value, { expanded: expandAll(value) })
    expect(rows.find((row) => row.label === 'empty')?.childCount).toBe(0)
    expect(rows.find((row) => row.label === 'none')?.childCount).toBe(0)
  })

  it('treats null as a primitive, not an empty object', () => {
    const rows = buildRows({ nothing: null }, { expanded: new Set(['']) })
    expect(rows.find((row) => row.label === 'nothing')?.kind).toBe('primitive')
  })
})

describe('expand-all budget', () => {
  it('refuses rather than building a tree large enough to freeze the tab', () => {
    const huge = Array.from({ length: 200 }, () => ({ a: 1, b: 2 }))
    expect(allContainerIds(huge, 50)).toBeNull()
  })

  it('stops counting once the budget is passed, so a huge body is not fully walked', () => {
    const huge = Array.from({ length: 10_000 }, (_, index) => index)
    expect(countNodes(huge, 10)).toBeGreaterThan(10)
  })

  it('expands everything by default while that stays affordable', () => {
    const value = { a: { b: 1 } }
    expect(defaultExpanded(value)).toEqual(expandAll(value))
  })

  it('falls back to the root alone when the body is too large to open fully', () => {
    const huge = Array.from({ length: 200 }, () => ({ a: 1 }))
    expect(defaultExpanded(huge, 50)).toEqual(new Set(['']))
  })
})

describe('display helpers', () => {
  it('quotes strings so they are distinguishable from numbers and booleans', () => {
    expect(formatPrimitive('12')).toBe('"12"')
    expect(formatPrimitive(12)).toBe('12')
    expect(formatPrimitive(null)).toBe('null')
    expect(formatPrimitive(false)).toBe('false')
  })

  it('summarises a collapsed container so it is not an opaque brace', () => {
    expect(summarise({ kind: 'array', childCount: 2 } as never)).toBe('2 items')
    expect(summarise({ kind: 'array', childCount: 1 } as never)).toBe('1 item')
    expect(summarise({ kind: 'object', childCount: 1 } as never)).toBe('1 key')
  })

  it('classifies kinds', () => {
    expect(kindOf([])).toBe('array')
    expect(kindOf({})).toBe('object')
    expect(kindOf(null)).toBe('primitive')
  })
})
