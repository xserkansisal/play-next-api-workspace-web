import { afterEach, describe, expect, it, vi } from 'vitest'

import { browserFetchRunner, describeFetchFailure } from '@/lib/request-runner'

describe('browserFetchRunner', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns status/duration/size/headers/body on a successful response', async () => {
    const headers = new Headers({ 'content-type': 'application/json', 'content-length': '13' })
    const response = new Response('{"ok":true}', { status: 200, statusText: 'OK', headers })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))

    const result = await browserFetchRunner.run({ method: 'GET', url: 'http://localhost:3000/health', headers: [], body: null })

    expect(result.kind).toBe('success')
    if (result.kind === 'success') {
      expect(result.status).toBe(200)
      expect(result.ok).toBe(true)
      expect(result.bodyText).toBe('{"ok":true}')
      expect(result.headers['content-type']).toBe('application/json')
      expect(result.sizeBytes).toBe(13)
      expect(result.durationMs).toBeGreaterThanOrEqual(0)
    }
  })

  it('reports a non-2xx response as a completed (not failed) execution', async () => {
    const response = new Response('{"error":"not found"}', { status: 404, statusText: 'Not Found' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response))

    const result = await browserFetchRunner.run({ method: 'GET', url: 'http://localhost:3000/missing', headers: [], body: null })

    expect(result.kind).toBe('success')
    if (result.kind === 'success') {
      expect(result.status).toBe(404)
      expect(result.ok).toBe(false)
    }
  })

  it('names CORS as the cause when the no-cors probe reaches the server', async () => {
    // First call is the real request and is blocked; the probe ignores CORS and succeeds, which
    // is only possible if the host actually answered.
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      // A genuinely opaque response cannot be constructed in a test; all the runner cares about
      // is that the probe resolves rather than throws.
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await browserFetchRunner.run({ method: 'POST', url: 'http://localhost:7799/game-math/startup-data', headers: [['Content-Type', 'application/json']], body: '{}' })

    expect(result.kind).toBe('failure')
    if (result.kind === 'failure') {
      expect(result.message).toContain('The server answered')
      expect(result.message).toContain('http://localhost:7799')
      expect(result.message).not.toContain('not a confirmed diagnosis')
    }
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ mode: 'no-cors', method: 'GET' })
    // `no-cors` rejects non-simple headers, so the probe must not forward them.
    expect(fetchMock.mock.calls[1][1]).not.toHaveProperty('headers')
    // The probe must not replay a side-effecting POST; it hits the origin root with no body.
    expect(fetchMock.mock.calls[1][0]).toBe('http://localhost:7799')
    expect(fetchMock.mock.calls[1][1]).not.toHaveProperty('body')
  })

  it('rules CORS out when the no-cors probe also fails to connect', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    const result = await browserFetchRunner.run({ method: 'GET', url: 'https://blocked.example', headers: [], body: null })

    expect(result.kind).toBe('failure')
    if (result.kind === 'failure') {
      expect(result.message).toContain('Failed to fetch')
      expect(result.message).toContain('could not reach')
      expect(result.message).toContain('not a CORS problem')
    }
  })
})

describe('describeFetchFailure', () => {
  const error = new TypeError('Failed to fetch')

  it('explains that curl and Postman are not bound by CORS, since that is the usual confusion', () => {
    expect(describeFetchFailure(error, 'reachable', 'http://localhost:7799/x')).toContain('curl or Postman')
  })

  it('keeps the honest, hedged wording when reachability could not be determined', () => {
    expect(describeFetchFailure(error, 'unknown', 'http://localhost:7799/x')).toContain('not a confirmed diagnosis')
  })

  it('always includes the raw error so the real failure is never hidden', () => {
    for (const reachability of ['reachable', 'unreachable', 'unknown'] as const) {
      expect(describeFetchFailure(error, reachability, 'http://x.test/y')).toContain('Failed to fetch')
    }
  })

  it('degrades gracefully when the URL cannot be parsed', () => {
    expect(describeFetchFailure(error, 'reachable', '{{unresolved}}/path')).toContain('that origin')
  })
})
