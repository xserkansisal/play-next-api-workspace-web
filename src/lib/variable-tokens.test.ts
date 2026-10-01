import { describe, expect, it } from 'vitest'

import { tokenizeTemplate, variableNames } from '@/lib/variable-tokens'

describe('tokenizeTemplate', () => {
  it('splits text and variable references, keeping offsets', () => {
    expect(tokenizeTemplate('{{url}}:{{ port }}/x')).toEqual([
      { kind: 'variable', text: '{{url}}', name: 'url', from: 0 },
      { kind: 'text', text: ':', from: 7 },
      { kind: 'variable', text: '{{ port }}', name: 'port', from: 8 },
      { kind: 'text', text: '/x', from: 18 },
    ])
  })

  it('returns plain text unchanged and ignores unbalanced braces', () => {
    expect(tokenizeTemplate('/orders {{open')).toEqual([{ kind: 'text', text: '/orders {{open', from: 0 }])
    expect(tokenizeTemplate('')).toEqual([])
  })

  it('lists referenced names', () => {
    expect(variableNames('{{a}}-{{b}}-{{a}}')).toEqual(['a', 'b', 'a'])
  })
})
