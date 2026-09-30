import { describe, expect, it } from 'vitest'

import { extractFromResponse, parsePath, suggestPaths } from '@/lib/response-extraction'
import type { ExecutionSuccess } from '@/lib/request-runner'

function response(bodyText: string, headers: Record<string, string> = {}, status = 200): ExecutionSuccess {
  return { kind: 'success', status, statusText: 'OK', ok: true, durationMs: 5, sizeBytes: bodyText.length, headers, bodyText }
}

describe('parsePath', () => {
  it('parses dotted, bracketed and quoted segments', () => {
    expect(parsePath('data.token')).toEqual([{ kind: 'key', name: 'data' }, { kind: 'key', name: 'token' }])
    expect(parsePath('items[0].id')).toEqual([{ kind: 'key', name: 'items' }, { kind: 'index', index: 0 }, { kind: 'key', name: 'id' }])
    expect(parsePath('$.a["odd key"]')).toEqual([{ kind: 'key', name: 'a' }, { kind: 'key', name: 'odd key' }])
  })

  it('rejects malformed paths rather than guessing', () => {
    expect(parsePath('')).toBeNull()
    expect(parsePath('a..b')).toBeNull()
    expect(parsePath('a.')).toBeNull()
    expect(parsePath('a[0')).toBeNull()
    expect(parsePath('a[x]')).toBeNull()
  })
})

describe('extractFromResponse', () => {
  it('reads a nested JSON value', () => {
    const result = extractFromResponse('data.accessToken', response('{"data":{"accessToken":"abc123"}}'))
    expect(result).toEqual({ ok: true, value: 'abc123' })
  })

  it('reads through array indexes and stringifies numbers and booleans', () => {
    const body = '{"items":[{"id":42,"active":true}]}'
    expect(extractFromResponse('items[0].id', response(body))).toEqual({ ok: true, value: '42' })
    expect(extractFromResponse('items[0].active', response(body))).toEqual({ ok: true, value: 'true' })
  })

  it('reads headers case-insensitively and the status code', () => {
    const res = response('{}', { location: '/orders/7' }, 201)
    expect(extractFromResponse('header:Location', res)).toEqual({ ok: true, value: '/orders/7' })
    expect(extractFromResponse('status', res)).toEqual({ ok: true, value: '201' })
  })

  it('reports a missing field instead of storing an empty value', () => {
    const result = extractFromResponse('data.token', response('{"data":{"other":1}}'))
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('no "token" field')
  })

  it('refuses to store an object or an explicit null', () => {
    const objectResult = extractFromResponse('data', response('{"data":{"a":1}}'))
    expect(objectResult.ok).toBe(false)
    expect(objectResult.ok === false && objectResult.error).toContain('an object')

    const nullResult = extractFromResponse('data', response('{"data":null}'))
    expect(nullResult.ok).toBe(false)
    expect(nullResult.ok === false && nullResult.error).toContain('null')
  })

  it('explains a non-JSON body rather than failing opaquely', () => {
    const result = extractFromResponse('data.token', response('<html>nope</html>'))
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('not valid JSON')
  })

  it('reports an out-of-range array index', () => {
    const result = extractFromResponse('items[3]', response('{"items":[1,2]}'))
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('out of range')
  })

  it('reports a missing header', () => {
    const result = extractFromResponse('header:location', response('{}'))
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.error).toContain('no "location" header')
  })
})

describe('suggestPaths', () => {
  it('lists paths that resolve to a single value', () => {
    const paths = suggestPaths(response('{"data":{"token":"t"},"items":[{"id":1}]}'))
    expect(paths).toContain('data.token')
    expect(paths).toContain('items[0].id')
    expect(paths).not.toContain('data')
  })

  it('returns nothing for a non-JSON body', () => {
    expect(suggestPaths(response('plain text'))).toEqual([])
  })
})
