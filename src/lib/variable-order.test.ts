import { describe, expect, it } from 'vitest'
import {
  DEFAULT_VARIABLE_ORDER,
  manualListFor,
  moveVariableName,
  nextSort,
  normalizeVariableOrder,
  orderVariableNames,
  renameInOrder,
  withManualList,
} from '@/lib/variable-order'

const values: Record<string, string> = { b: '2', a: '10', c: '1' }
const valueOf = (name: string) => values[name]!

describe('orderVariableNames', () => {
  it('sorts by key, naturally and case-insensitively', () => {
    expect(orderVariableNames(['item10', 'Item2', 'item1'], valueOf, { field: 'key', direction: 'asc' })).toEqual(['item1', 'Item2', 'item10'])
  })

  it('sorts by value in both directions', () => {
    expect(orderVariableNames(['a', 'b', 'c'], valueOf, { field: 'value', direction: 'asc' })).toEqual(['c', 'b', 'a'])
    expect(orderVariableNames(['a', 'b', 'c'], valueOf, { field: 'value', direction: 'desc' })).toEqual(['a', 'b', 'c'])
  })

  it('follows the manual list, ignores names that are gone and appends new ones by key', () => {
    expect(orderVariableNames(['a', 'b', 'c', 'd'], valueOf, null, ['c', 'gone', 'a'])).toEqual(['c', 'a', 'b', 'd'])
  })
})

describe('moveVariableName', () => {
  const visible = ['a', 'b', 'c', 'd']
  it.each([
    ['top', ['c', 'a', 'b', 'd']],
    ['up', ['a', 'c', 'b', 'd']],
    ['down', ['a', 'b', 'd', 'c']],
    ['bottom', ['a', 'b', 'd', 'c']],
  ] as const)('moves %s', (target, expected) => {
    expect(moveVariableName(visible, [], 'c', target)).toEqual(expected)
  })

  it('drops before and after another row', () => {
    expect(moveVariableName(visible, [], 'd', { before: 'b' })).toEqual(['a', 'd', 'b', 'c'])
    expect(moveVariableName(visible, [], 'a', { after: 'c' })).toEqual(['b', 'c', 'a', 'd'])
  })

  it('keeps hidden names from the stored list at the end', () => {
    expect(moveVariableName(['a', 'b'], ['x', 'b', 'a'], 'b', 'top')).toEqual(['b', 'a', 'x'])
  })

  it('stays put at the edges and for unknown targets', () => {
    expect(moveVariableName(visible, [], 'a', 'up')).toEqual(visible)
    expect(moveVariableName(visible, [], 'd', 'down')).toEqual(visible)
    expect(moveVariableName(visible, [], 'b', { before: 'missing' })).toEqual(visible)
  })
})

describe('preference helpers', () => {
  it('cycles a column through ascending, descending and manual', () => {
    expect(nextSort(null, 'key')).toEqual({ field: 'key', direction: 'asc' })
    expect(nextSort({ field: 'key', direction: 'asc' }, 'key')).toEqual({ field: 'key', direction: 'desc' })
    expect(nextSort({ field: 'key', direction: 'desc' }, 'key')).toBeNull()
    expect(nextSort({ field: 'key', direction: 'desc' }, 'value')).toEqual({ field: 'value', direction: 'asc' })
  })

  it('keeps manual lists per scope and per environment', () => {
    let prefs = withManualList(DEFAULT_VARIABLE_ORDER, 'environment', 'env-1', ['a'])
    prefs = withManualList(prefs, 'user', null, ['u'])
    expect(manualListFor(prefs, 'environment', 'env-1')).toEqual(['a'])
    expect(manualListFor(prefs, 'environment', 'env-2')).toEqual([])
    expect(manualListFor(prefs, 'user', 'env-1')).toEqual(['u'])
  })

  it('keeps a renamed variable in place', () => {
    expect(renameInOrder(['a', 'b', 'c'], 'b', 'z')).toEqual(['a', 'z', 'c'])
  })

  it('normalizes anything into a valid preference', () => {
    expect(normalizeVariableOrder('nope')).toEqual(DEFAULT_VARIABLE_ORDER)
    expect(normalizeVariableOrder({ sort: null, manual: { user: ['a', 1], environments: { e: ['x'], bad: 'y' } }, updatedAt: 't' })).toEqual({
      version: 1, sort: null, manual: { user: ['a'], global: [], environments: { e: ['x'], bad: [] } }, updatedAt: 't',
    })
    expect(normalizeVariableOrder({ sort: { field: 'size', direction: 'asc' } }).sort).toEqual(DEFAULT_VARIABLE_ORDER.sort)
  })
})
