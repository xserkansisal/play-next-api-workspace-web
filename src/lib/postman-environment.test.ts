import { describe, expect, it } from 'vitest'

import {
  detectPostmanFileKind,
  environmentFromCollectionVariables,
  exportEnvironmentToPostman,
  parsePostmanEnvironment,
} from '@/lib/postman-environment'

function envFile(values: unknown[], name = 'Staging') {
  return { id: 'abc', name, values, _postman_variable_scope: 'environment' }
}

describe('detectPostmanFileKind', () => {
  it('recognizes an environment by its scope marker', () => {
    expect(detectPostmanFileKind(envFile([]))).toBe('environment')
  })

  it('recognizes an environment that omits the scope marker', () => {
    expect(detectPostmanFileKind({ name: 'X', values: [] })).toBe('environment')
  })

  it('recognizes a collection', () => {
    expect(detectPostmanFileKind({ info: { name: 'C' }, item: [] })).toBe('collection')
  })

  it('recognizes a globals export separately from an environment', () => {
    expect(detectPostmanFileKind({ values: [], _postman_variable_scope: 'globals' })).toBe('globals')
  })

  it('reports anything else as unknown', () => {
    expect(detectPostmanFileKind([1, 2])).toBe('unknown')
    expect(detectPostmanFileKind('nope')).toBe('unknown')
    expect(detectPostmanFileKind(null)).toBe('unknown')
  })
})

describe('parsePostmanEnvironment', () => {
  it('maps values into enabled/disabled variables', () => {
    const plan = parsePostmanEnvironment(envFile([
      { key: 'baseUrl', value: 'https://api.example.com', type: 'default', enabled: true },
      { key: 'legacy', value: 'x', enabled: false },
    ]))
    expect(plan.errors).toEqual([])
    expect(plan.name).toBe('Staging')
    expect(plan.sourceCount).toBe(2)
    expect(plan.variables).toEqual([
      { key: 'baseUrl', value: 'https://api.example.com', enabled: true },
      { key: 'legacy', value: 'x', enabled: false },
    ])
  })

  it('treats a missing enabled flag as enabled', () => {
    const plan = parsePostmanEnvironment(envFile([{ key: 'a', value: '1' }]))
    expect(plan.variables[0].enabled).toBe(true)
  })

  it('keeps the first of duplicate keys and discloses it, because the API rejects duplicates', () => {
    const plan = parsePostmanEnvironment(envFile([
      { key: 'token', value: 'first' },
      { key: 'token', value: 'second' },
    ]))
    expect(plan.variables).toEqual([{ key: 'token', value: 'first', enabled: true }])
    expect(plan.warnings.join(' ')).toContain('duplicate variable key')
  })

  it('skips keys the API would reject and says how many', () => {
    const plan = parsePostmanEnvironment(envFile([
      { key: 'has space', value: '1' },
      { key: '{{braced}}', value: '2' },
      { key: 'ok', value: '3' },
      { key: '   ', value: '4' },
    ]))
    expect(plan.variables).toEqual([{ key: 'ok', value: '3', enabled: true }])
    expect(plan.warnings.join(' ')).toContain('2 variable(s) had a key containing whitespace or braces')
    expect(plan.warnings.join(' ')).toContain('1 value(s) had no key')
  })

  it('warns that secret-typed values are withheld by Postman rather than genuinely empty', () => {
    const plan = parsePostmanEnvironment(envFile([{ key: 'apiKey', value: '', type: 'secret', enabled: true }]))
    expect(plan.variables).toEqual([{ key: 'apiKey', value: '', enabled: true, isSecret: true }])
    expect(plan.warnings.join(' ')).toContain('marked "secret"')
  })

  it('stringifies non-string values rather than dropping them', () => {
    const plan = parsePostmanEnvironment(envFile([
      { key: 'port', value: 8080 },
      { key: 'debug', value: false },
      { key: 'nothing', value: null },
    ]))
    expect(plan.variables).toEqual([
      { key: 'port', value: '8080', enabled: true },
      { key: 'debug', value: 'false', enabled: true },
      { key: 'nothing', value: '', enabled: true },
    ])
  })

  it('truncates over-long values and discloses it', () => {
    const plan = parsePostmanEnvironment(envFile([{ key: 'big', value: 'x'.repeat(9000) }]))
    expect(plan.variables[0].value).toHaveLength(8192)
    expect(plan.warnings.join(' ')).toContain('were truncated')
  })

  it('rejects an environment with more usable variables than the API accepts', () => {
    const values = Array.from({ length: 501 }, (_, index) => ({ key: `k${index}`, value: '1' }))
    const plan = parsePostmanEnvironment(envFile(values))
    expect(plan.errors.join(' ')).toContain('over the 500 limit')
  })

  it('points a collection file at the collection importer instead of failing obscurely', () => {
    const plan = parsePostmanEnvironment({ info: { name: 'C' }, item: [] })
    expect(plan.errors.join(' ')).toContain('collection* export')
  })

  it('rejects a globals export with an explanation', () => {
    const plan = parsePostmanEnvironment({ values: [], _postman_variable_scope: 'globals' })
    expect(plan.errors.join(' ')).toContain('globals')
  })

  it('rejects a file with no values array', () => {
    const plan = parsePostmanEnvironment({ _postman_variable_scope: 'environment', name: 'X' })
    expect(plan.errors.join(' ')).toContain('no "values" array')
  })

  it('falls back to a default name and notes an empty result', () => {
    const plan = parsePostmanEnvironment({ _postman_variable_scope: 'environment', values: [] })
    expect(plan.name).toBe('Imported environment')
    expect(plan.warnings.join(' ')).toContain('No usable variables')
  })
})

describe('exportEnvironmentToPostman', () => {
  it('produces a file the importer reads back with the same variables', () => {
    const exported = exportEnvironmentToPostman({
      id: 'env-1',
      name: 'Staging',
      variables: [
        { key: 'baseUrl', value: 'https://api.example.com', enabled: true },
        { key: 'legacy', value: 'old', enabled: false },
        { key: 'ACCESS_TOKEN', value: 'private-value', enabled: true, isSecret: true },
      ],
    })
    expect(exported._postman_variable_scope).toBe('environment')
    expect(detectPostmanFileKind(exported)).toBe('environment')

    const round = parsePostmanEnvironment(exported)
    expect(round.errors).toEqual([])
    expect(round.name).toBe('Staging')
    expect(round.variables).toEqual([
      { key: 'baseUrl', value: 'https://api.example.com', enabled: true },
      { key: 'legacy', value: 'old', enabled: false },
      { key: 'ACCESS_TOKEN', value: 'private-value', enabled: true, isSecret: true },
    ])
    expect(exported.values).toEqual([
      { key: 'baseUrl', value: 'https://api.example.com', type: 'default', enabled: true },
      { key: 'legacy', value: 'old', type: 'default', enabled: false },
      { key: 'ACCESS_TOKEN', value: 'private-value', type: 'secret', enabled: true },
    ])
  })
})

describe('environmentFromCollectionVariables', () => {
  it('returns null when the collection declares none', () => {
    expect(environmentFromCollectionVariables('C', undefined)).toBeNull()
    expect(environmentFromCollectionVariables('C', [])).toBeNull()
  })

  it('builds a named plan from collection-level variables', () => {
    const plan = environmentFromCollectionVariables('Payments', [{ key: 'baseUrl', value: 'https://x' }])
    expect(plan?.name).toBe('Payments variables')
    expect(plan?.variables).toEqual([{ key: 'baseUrl', value: 'https://x', enabled: true }])
  })

  it('applies the same key rules as a real environment file', () => {
    const plan = environmentFromCollectionVariables('C', [{ key: 'bad key', value: '1' }, { key: 'good', value: '2' }])
    expect(plan?.variables).toEqual([{ key: 'good', value: '2', enabled: true }])
  })
})
