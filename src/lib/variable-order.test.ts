import { describe, expect, it } from 'vitest'

import { mergeVariableOrder, moveVariable, moveVariableBefore, replaceVisibleVariableOrder } from '@/lib/variable-order'

describe('variable order', () => {
  it('retains known names and appends newly discovered names alphabetically', () => {
    expect(mergeVariableOrder(['zeta', 'alpha'], ['beta', 'zeta', 'gamma'])).toEqual([
      'zeta', 'alpha', 'beta', 'gamma',
    ])
  })

  it.each([
    ['up', ['b', 'a', 'c']],
    ['down', ['a', 'c', 'b']],
    ['top', ['b', 'a', 'c']],
    ['bottom', ['a', 'c', 'b']],
  ] as const)('moves a variable %s', (move, expected) => {
    expect(moveVariable(['a', 'b', 'c'], 'b', move)).toEqual(expected)
  })

  it('does not move past either boundary', () => {
    expect(moveVariable(['a', 'b'], 'a', 'up')).toEqual(['a', 'b'])
    expect(moveVariable(['a', 'b'], 'b', 'down')).toEqual(['a', 'b'])
  })

  it('moves a dragged variable before its target', () => {
    expect(moveVariableBefore(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b'])
    expect(moveVariableBefore(['a', 'b', 'c'], 'b', 'b')).toEqual(['a', 'b', 'c'])
  })

  it('preserves hidden known-name positions when visible rows are reordered', () => {
    expect(replaceVisibleVariableOrder(['alpha', 'legacy', 'gamma'], ['gamma', 'alpha'], ['alpha', 'gamma']))
      .toEqual(['gamma', 'legacy', 'alpha'])
  })
})
