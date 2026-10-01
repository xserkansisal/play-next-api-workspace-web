import { describe, expect, it } from 'vitest'

import { countChanges, diffLines } from '@/lib/json-diff'

describe('diffLines', () => {
  it('reports no changes for identical text', () => {
    const lines = diffLines('a\nb', 'a\nb')
    expect(lines.every((line) => line.type === 'same')).toBe(true)
    expect(countChanges(lines)).toEqual({ added: 0, removed: 0 })
  })

  it('lists a changed line as a removal followed by an addition', () => {
    const lines = diffLines('a\nb\nc', 'a\nB\nc')
    expect(lines.map((line) => line.type)).toEqual(['same', 'removed', 'added', 'same'])
    expect(countChanges(lines)).toEqual({ added: 1, removed: 1 })
  })

  it('handles pure insertions and deletions at the edges', () => {
    expect(diffLines('a', 'a\nb').map((line) => line.type)).toEqual(['same', 'added'])
    expect(diffLines('x\na', 'a').map((line) => line.type)).toEqual(['removed', 'same'])
  })
})
