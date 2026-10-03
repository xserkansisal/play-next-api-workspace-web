import { describe, expect, it } from 'vitest'

import { applyCompletion, findCompletionContext, previewValue, suggestVariables } from '@/lib/variable-completion'
import type { VariableResolution } from '@/lib/variable-scopes'

const variables: Record<string, VariableResolution> = {
  baseUrl: { value: 'https://api.test', origin: 'environment', shadowed: ['global'] },
  tenantId: { value: 'acme', origin: 'environment', shadowed: [] },
  userId: { value: '42', origin: 'user', shadowed: [] },
  timeout: { value: '3000', origin: 'global', shadowed: [] },
  idempotencyKey: { value: 'k', origin: 'global', shadowed: [] },
}

describe('findCompletionContext', () => {
  it('detects an unclosed reference left of the caret', () => {
    expect(findCompletionContext('{{baseUrl}}/{{', 14)).toEqual({ from: 12, query: '' })
    expect(findCompletionContext('x {{ ten', 8)).toEqual({ from: 2, query: 'ten' })
  })

  it('uses the full name when the caret is inside a closed reference', () => {
    const text = '{{next-url}}/game-sessions/{{session}}/bets'
    expect(findCompletionContext(text, text.indexOf('url') + 1)).toEqual({ from: 0, query: 'next-url' })
    const sessionReference = text.indexOf('{{session}}')
    expect(findCompletionContext(text, sessionReference + 5)).toEqual({ from: sessionReference, query: 'session' })
  })

  it('ignores closed, abandoned or absent references', () => {
    expect(findCompletionContext('{{baseUrl}}/x', 13)).toBeNull()
    expect(findCompletionContext('{{a\nb', 5)).toBeNull()
    expect(findCompletionContext('plain', 5)).toBeNull()
  })
})

describe('suggestVariables', () => {
  it('orders by precedence when nothing is typed', () => {
    expect(suggestVariables(variables, '').map((s) => s.name)).toEqual(['userId', 'baseUrl', 'tenantId', 'idempotencyKey', 'timeout'])
  })

  it('puts prefix matches before substring matches, case-insensitively', () => {
    const result = suggestVariables(variables, 'Id')
    expect(result.map((s) => s.name)).toEqual(['idempotencyKey', 'userId', 'tenantId'])
    expect(result[1].matchIndex).toBe(4)
  })

  it('preserves the explicit secret marker on suggestions for display masking', () => {
    const result = suggestVariables({
      credential: { value: 'private-value', origin: 'environment', shadowed: [], isSecret: true },
    }, '')
    expect(result[0]).toMatchObject({ name: 'credential', value: 'private-value', isSecret: true })
    expect(previewValue(result[0].name, result[0].value, result[0].isSecret)).toMatch(/^•+$/)
  })
})

describe('applyCompletion', () => {
  it('closes the reference and moves the caret after it', () => {
    const text = '{{baseUrl}}/{{te'
    expect(applyCompletion(text, findCompletionContext(text, 16)!, 16, 'tenantId')).toMatchObject({ value: '{{baseUrl}}/{{tenantId}}', caret: 24 })
  })

  it('does not double existing closing braces when editing inside a reference', () => {
    const text = '{{bas}}/x'
    expect(applyCompletion(text, findCompletionContext(text, 5)!, 5, 'baseUrl').value).toBe('{{baseUrl}}/x')
  })

  it('replaces the full existing name when the caret is inside it', () => {
    const text = '{{next-url}}/game-sessions/{{session}}/bets'
    const caret = text.indexOf('url') + 1
    const context = findCompletionContext(text, caret)!
    expect(context.query).toBe('next-url')
    expect(applyCompletion(text, context, caret, 'nextUrl').value).toBe('{{nextUrl}}/game-sessions/{{session}}/bets')
  })
})

describe('previewValue', () => {
  it('masks values of secret-looking names', () => {
    expect(previewValue('authToken', 'abc')).toMatch(/^•+$/)
    expect(previewValue('deploymentTarget', 'private-value', true)).toMatch(/^•+$/)
    expect(previewValue('baseUrl', 'https://x')).toBe('https://x')
    expect(previewValue('baseUrl', '')).toBe('(empty)')
  })
})
