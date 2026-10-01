import { describe, expect, it } from 'vitest'

import { prepareRequest, substituteVariables, parseJsonWithLocation, buildVariableMap } from '@/lib/request-preparation'
import { extractFromResponse } from '@/lib/response-extraction'
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

  it('preserves an explicitly selected empty JSON body and assigns its content type', () => {
    const outcome = prepareRequest(baseRequest({
      method: 'POST',
      url: 'http://localhost:3000/x',
      body: { type: 'json', content: '' },
    }), {})
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.request.body).toBe('')
      expect(outcome.request.headers).toContainEqual(['Content-Type', 'application/json'])
    }
  })

  it('URL-encodes resolved rows while preserving duplicate keys and row order', () => {
    const outcome = prepareRequest(baseRequest({
      method: 'POST',
      url: 'http://localhost:3000/x',
      headers: [{ key: 'Content-Type', value: 'text/plain', enabled: true, description: '' }],
      body: { type: 'form-urlencoded', content: 'name={{name}}&tag=first&tag=second+value' },
    }), { name: 'Sam Lee' })
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.request.body).toBe('name=Sam+Lee&tag=first&tag=second+value')
      expect(outcome.request.headers).toEqual([['Content-Type', 'application/x-www-form-urlencoded']])
    }
  })

  it('builds multipart text from enabled fields and uses the same generated boundary in the header', () => {
    const outcome = prepareRequest(baseRequest({
      method: 'POST',
      url: 'http://localhost:3000/x',
      body: {
        type: 'multipart',
        content: JSON.stringify([
          { key: 'description', value: 'Hello {{name}}', enabled: true },
          { key: 'ignored', value: 'not sent', enabled: false },
          { key: 'quoted"name', value: 'A sample', enabled: true },
        ]),
      },
    }), { name: 'Sam' })
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      const contentType = outcome.request.headers.find(([key]) => key.toLowerCase() === 'content-type')?.[1]
      const boundary = contentType?.match(/boundary=(.+)$/)?.[1]
      expect(boundary).toBeTruthy()
      expect(contentType).toBe(`multipart/form-data; boundary=${boundary}`)
      expect(outcome.request.body).toContain(`--${boundary}\r\n`)
      expect(outcome.request.body).toContain('name="description"\r\n\r\nHello Sam')
      expect(outcome.request.body).toContain('name="quoted\\"name"')
      expect(outcome.request.body).not.toContain('not sent')
      expect(outcome.request.body).toContain(`--${boundary}--\r\n`)
    }
  })

  it('reports malformed multipart content instead of sending or replacing it', () => {
    const outcome = prepareRequest(baseRequest({
      method: 'POST',
      url: 'http://localhost:3000/x',
      body: { type: 'multipart', content: '{bad json' },
    }), {})
    expect(outcome).toEqual({ ok: false, reason: 'invalid-body', message: 'Multipart fields must be valid JSON.' })
  })

  it('rejects body content above the persisted request limit', () => {
    const outcome = prepareRequest(baseRequest({
      method: 'POST',
      url: 'http://localhost:3000/x',
      body: { type: 'raw', content: 'x'.repeat(1_000_001) },
    }), {})
    expect(outcome).toEqual({
      ok: false,
      reason: 'invalid-body',
      message: 'Request body content exceeds the 1,000,000 character limit.',
    })
  })

  it('sends raw text verbatim and preserves a manually selected media type', () => {
    const outcome = prepareRequest(baseRequest({
      method: 'POST',
      url: 'http://localhost:3000/x',
      headers: [{ key: 'Content-Type', value: 'application/xml', enabled: true, description: '' }],
      body: { type: 'raw', content: '<root>{{value}}</root>' },
    }), { value: 'plain text' })
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.request.body).toBe('<root>plain text</root>')
      expect(outcome.request.headers).toEqual([['Content-Type', 'application/xml']])
    }
  })

  it('uses JSON envelope validation and content type for GraphQL bodies', () => {
    const outcome = prepareRequest(baseRequest({
      method: 'POST',
      url: 'http://localhost:3000/graphql',
      body: { type: 'graphql', content: '{"query":"query { status }","variables":{}}' },
    }), {})
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.request.body).toBe('{"query":"query { status }","variables":{}}')
      expect(outcome.request.headers).toContainEqual(['Content-Type', 'application/json'])
    }
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

describe('chaining a captured response value into a later request', () => {
  it('substitutes a runtime variable into the body and lets it override the environment', () => {
    const environment = buildVariableMap([
      { key: 'baseUrl', value: 'http://localhost:3000', enabled: true },
      { key: 'token', value: 'placeholder-from-environment', enabled: true },
    ])
    const captured = extractFromResponse('data.accessToken', {
      kind: 'success', status: 200, statusText: 'OK', ok: true, durationMs: 1, sizeBytes: 0, headers: {},
      bodyText: '{"data":{"accessToken":"abc123"}}',
    })
    expect(captured.ok).toBe(true)
    if (!captured.ok) return

    const variables = { ...environment, token: captured.value }
    const resource = baseRequest({
      method: 'POST',
      url: '{{baseUrl}}/orders',
      body: { type: 'json', content: '{"auth":"{{token}}"}' },
    })

    const outcome = prepareRequest(resource, variables)
    expect(outcome.ok).toBe(true)
    if (outcome.ok) {
      expect(outcome.request.body).toBe('{"auth":"abc123"}')
      expect(outcome.request.url).toBe('http://localhost:3000/orders')
    }
  })
})

describe('substituting a variable into a JSON body', () => {
  const jsonBody = (content: string) =>
    baseRequest({ method: 'POST', url: 'http://localhost:3000/step', body: { type: 'json', content } })

  const mathState = '{"totalWin":0,"bet":100}'

  it('inserts an object as raw JSON when the reference is written outside quotes', () => {
    const outcome = prepareRequest(jsonBody('{"mathState": {{mathState}}}'), { mathState })
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(JSON.parse(outcome.request.body!)).toEqual({ mathState: { totalWin: 0, bet: 100 } })
  })

  it('escapes the value into a JSON string when the reference is written inside quotes', () => {
    // Quoting a placeholder is the natural edit inside a JSON body, where every other value is
    // quoted. It used to fail with a parser error naming a character position and never mentioning
    // the variable. It now means exactly what it looks like: a string holding that text.
    const outcome = prepareRequest(jsonBody('{"mathState": "{{mathState}}"}'), { mathState })
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(JSON.parse(outcome.request.body!)).toEqual({ mathState })
  })

  it('escapes quotes and backslashes so a value containing them cannot break the body', () => {
    const outcome = prepareRequest(jsonBody('{"note": "say {{phrase}} now"}'), { phrase: 'he said "hi"\\done' })
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(JSON.parse(outcome.request.body!)).toEqual({ note: 'say he said "hi"\\done now' })
  })

  it('escapes newlines and tabs, which are not legal raw inside a JSON string', () => {
    const outcome = prepareRequest(jsonBody('{"note": "{{text}}"}'), { text: 'line1\nline2\tend' })
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(JSON.parse(outcome.request.body!)).toEqual({ note: 'line1\nline2\tend' })
  })

  it('does not treat a quote inside an escape sequence as the end of a string', () => {
    const outcome = prepareRequest(jsonBody('{"a": "\\"{{v}}", "b": {{v}}}'), { v: '1' })
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(JSON.parse(outcome.request.body!)).toEqual({ a: '"1', b: 1 })
  })

  it('still reports a missing variable used inside a quoted body value', () => {
    const outcome = prepareRequest(jsonBody('{"mathState": "{{mathState}}"}'), {})
    expect(outcome).toEqual({ ok: false, reason: 'missing-variables', missing: ['mathState'] })
  })

  it('leaves URLs and headers unescaped, since only the body is JSON', () => {
    const resource = baseRequest({
      url: 'http://localhost:3000/{{path}}',
      headers: [{ key: 'X-Raw', value: '{{raw}}', enabled: true, description: '' }],
    })
    const outcome = prepareRequest(resource, { path: 'a b', raw: 'he said "hi"' })
    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.request.headers).toContainEqual(['X-Raw', 'he said "hi"'])
  })
})
