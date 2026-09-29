import { describe, expect, it } from 'vitest'

import { prepareRequest, substituteVariables, parseJsonWithLocation, buildVariableMap } from '@/lib/request-preparation'
import { newRequest } from '@/lib/workspace-ui'
import type { RequestResource } from '@/lib/workspace-types'

function baseRequest(overrides: Partial<RequestResource> = {}): RequestResource {
  return { ...newRequest('r1', 'Test request', 'c1'), ...overrides }
}

describe('substituteVariables', () => {
  it('replaces all defined {{name}} references and reports names that have no matching variable', () => {
    const { value, missing } = substituteVariables('{{baseUrl}}/users?limit={{limit}}', { baseUrl: 'http://localhost:3000' })
    expect(value).toBe('http://localhost:3000/users?limit={{limit}}')
    expect(missing).toEqual(['limit'])
  })

  it('is case-sensitive, matching the API environment-variable contract', () => {
    const { missing } = substituteVariables('{{BaseUrl}}', { baseUrl: 'http://localhost:3000' })
    expect(missing).toEqual(['BaseUrl'])
  })
})

describe('parseJsonWithLocation', () => {
  it('resolves a JSON.parse error into a 1-based line and column', () => {
    const result = parseJsonWithLocation('{\n  "a":\n  "b":\n')
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.line).toBeGreaterThanOrEqual(1)
      expect(result.error.column).toBeGreaterThan(0)
    }
  })

  it('parses valid JSON', () => {
    expect(parseJsonWithLocation('{"a":1}')).toEqual({ ok: true, value: { a: 1 } })
  })
})

describe('prepareRequest', () => {
  it('blocks sending and reports every missing variable when one is undefined', () => {
    const resource = baseRequest({ url: '{{baseUrl}}/users', headers: [{ key: 'X-Env', value: '{{stage}}', enabled: true, description: '' }] })
    const outcome = prepareRequest(resource, { baseUrl: 'http://localhost:3000' })
    expect(outcome).toEqual({ ok: false, reason: 'missing-variables', missing: ['stage'] })
  })

  it('validates the JSON body only AFTER substitution, since {{vars}} can make a body look invalid beforehand', () => {
    // Invalid JSON before substitution (bare template token as a bareword) becomes valid once resolved.
    const resource = baseRequest({
      method: 'POST',
      url: 'http://localhost:3000/users',
      body: { type: 'json', content: '{"name": {{name}}}' },
    })
    const invalidBefore = prepareRequest(resource, {})
    expect(invalidBefore).toEqual({ ok: false, reason: 'missing-variables', missing: ['name'] })

    const resolved = prepareRequest(resource, { name: '"Ada"' })
    expect(resolved.ok).toBe(true)
    if (resolved.ok) expect(resolved.request.body).toBe('{"name": "Ada"}')
  })

  it('blocks sending on invalid JSON that remains invalid after substitution', () => {
    const resource = baseRequest({ method: 'POST', url: 'http://localhost:3000/x', body: { type: 'json', content: '{not json}' } })
    const outcome = prepareRequest(resource, {})
    expect(outcome).toEqual({ ok: false, reason: 'invalid-json', error: expect.objectContaining({ line: 1 }) })
  })

  it('drops disabled query params/headers and merges enabled ones into the final URL', () => {
    const resource = baseRequest({
      url: 'http://localhost:3000/users',
      queryParams: [
        { key: 'limit', value: '10', enabled: true, description: '' },
        { key: 'skip', value: '5', enabled: false, description: '' },
      ],
    })
    const outcome = prepareRequest(resource, {})
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.request.url).toBe('http://localhost:3000/users?limit=10')
  })

  it('never attaches a body to a GET request, matching fetch/HTTP semantics', () => {
    const resource = baseRequest({ method: 'GET', url: 'http://localhost:3000/x', body: { type: 'json', content: '{"a":1}' } })
    const outcome = prepareRequest(resource, {})
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.request.body).toBeNull()
  })

  it('auto-adds a JSON content-type header when a body is present and none was set', () => {
    const resource = baseRequest({ method: 'POST', url: 'http://localhost:3000/x', body: { type: 'json', content: '{"a":1}' } })
    const outcome = prepareRequest(resource, {})
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.request.headers).toContainEqual(['Content-Type', 'application/json'])
  })

  it('rejects a URL that is still not absolute once variables are resolved', () => {
    const resource = baseRequest({ url: 'not-a-url' })
    const outcome = prepareRequest(resource, {})
    expect(outcome).toEqual({ ok: false, reason: 'invalid-url', message: expect.stringContaining('not-a-url') })
  })
})

describe('buildVariableMap', () => {
  it('excludes disabled and empty-key variables', () => {
    expect(buildVariableMap([
      { key: 'baseUrl', value: 'http://localhost:3000', enabled: true },
      { key: 'disabled', value: 'x', enabled: false },
      { key: '', value: 'y', enabled: true },
    ])).toEqual({ baseUrl: 'http://localhost:3000' })
  })
})
