import { afterEach, describe, expect, it, vi } from 'vitest'

import { apiClient } from '@/lib/api'
import { browserFetchRunner, canProxy, describeFetchFailure, serverProxyRunner } from '@/lib/request-runner'

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

describe('serverProxyRunner', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function axiosFailure(status: number, code: string, message: string) {
    return Object.assign(new Error(message), {
      isAxiosError: true,
      response: { status, data: { error: { code, message } } },
    })
  }

  it('sends the request to the API proxy rather than to the target', async () => {
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({
      data: { status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, bodyText: '{"ok":true}', durationMs: 42, sizeBytes: 11, truncated: false },
    })
    const request = { method: 'POST', url: 'http://localhost:7799/x', headers: [['Content-Type', 'application/json']] as [string, string][], body: '{}' }

    const result = await serverProxyRunner.run(request)

    expect(post).toHaveBeenCalledWith('/proxy', request, expect.objectContaining({ timeout: expect.any(Number) }))
    expect(result.kind).toBe('success')
    if (result.kind === 'success') {
      expect(result.status).toBe(200)
      expect(result.bodyText).toBe('{"ok":true}')
      // The API timed the upstream call itself; its measurement excludes the hop to the API.
      expect(result.durationMs).toBe(42)
    }
  })

  it('treats an upstream error status as a completed execution, not a failure', async () => {
    vi.spyOn(apiClient, 'post').mockResolvedValue({
      data: { status: 404, statusText: 'Not Found', headers: {}, bodyText: 'nope', durationMs: 5, sizeBytes: 4, truncated: false },
    })

    const result = await serverProxyRunner.run({ method: 'GET', url: 'http://localhost:7799/missing', headers: [], body: null })

    expect(result.kind).toBe('success')
    if (result.kind === 'success') {
      expect(result.status).toBe(404)
      expect(result.ok).toBe(false)
    }
  })

  it('marks a truncated body, so an incomplete response is not mistaken for the whole thing', async () => {
    vi.spyOn(apiClient, 'post').mockResolvedValue({
      data: { status: 200, statusText: 'OK', headers: {}, bodyText: 'xxx', durationMs: 1, sizeBytes: 3, truncated: true },
    })

    const result = await serverProxyRunner.run({ method: 'GET', url: 'http://localhost:7799/big', headers: [], body: null })

    expect(result.kind).toBe('success')
    if (result.kind === 'success') expect(result.bodyText).toContain('Truncated')
  })

  it('explains that an operator has to enable it, rather than showing a raw error code', async () => {
    vi.spyOn(apiClient, 'post').mockRejectedValue(axiosFailure(403, 'PROXY_DISABLED', 'Server-side request execution is disabled.'))

    const result = await serverProxyRunner.run({ method: 'GET', url: 'http://localhost:7799/x', headers: [], body: null })

    expect(result.kind).toBe('failure')
    if (result.kind === 'failure') {
      expect(result.message).toContain('PROXY_ALLOWED_HOSTS')
      expect(result.message).not.toContain('PROXY_DISABLED')
    }
  })

  it('passes through the allow-list message and warns the browser will not work either', async () => {
    vi.spyOn(apiClient, 'post').mockRejectedValue(
      axiosFailure(403, 'PROXY_HOST_NOT_ALLOWED', '"evil.test" is not in PROXY_ALLOWED_HOSTS.'),
    )

    const result = await serverProxyRunner.run({ method: 'GET', url: 'http://evil.test/x', headers: [], body: null })

    expect(result.kind).toBe('failure')
    if (result.kind === 'failure') {
      expect(result.message).toContain('not in PROXY_ALLOWED_HOSTS')
      expect(result.message).toContain('CORS headers')
    }
  })

  it('reports a bad gateway from the proxy with the API-supplied reason', async () => {
    vi.spyOn(apiClient, 'post').mockRejectedValue(
      axiosFailure(502, 'PROXY_REQUEST_FAILED', 'This server could not reach localhost:7799: connect ECONNREFUSED'),
    )

    const result = await serverProxyRunner.run({ method: 'GET', url: 'http://localhost:7799/x', headers: [], body: null })

    expect(result.kind).toBe('failure')
    if (result.kind === 'failure') expect(result.message).toContain('ECONNREFUSED')
  })
})

describe('canProxy', () => {
  const on = (hosts: string[]) => ({ enabled: true, allowedHosts: hosts })

  it('is false when the proxy is disabled or unknown', () => {
    expect(canProxy('http://localhost:7799/a', null)).toBe(false)
    expect(canProxy('http://localhost:7799/a', { enabled: false, allowedHosts: ['localhost:7799'] })).toBe(false)
  })

  it('matches a host:port entry', () => {
    expect(canProxy('http://localhost:7799/a', on(['localhost:7799']))).toBe(true)
    expect(canProxy('http://localhost:6620/a', on(['localhost:7799']))).toBe(false)
  })

  it('matches a bare host entry on any port', () => {
    expect(canProxy('http://example.com:8080/a', on(['example.com']))).toBe(true)
    expect(canProxy('https://example.com/a', on(['example.com']))).toBe(true)
  })

  it('infers the default port so an implicit port still matches an explicit entry', () => {
    expect(canProxy('http://example.com/a', on(['example.com:80']))).toBe(true)
    expect(canProxy('https://example.com/a', on(['example.com:443']))).toBe(true)
    expect(canProxy('https://example.com/a', on(['example.com:80']))).toBe(false)
  })

  it('does not treat a suffix or subdomain as a match', () => {
    expect(canProxy('http://evil-example.com/a', on(['example.com']))).toBe(false)
    expect(canProxy('http://example.com.attacker.net/a', on(['example.com']))).toBe(false)
    expect(canProxy('http://sub.example.com/a', on(['example.com']))).toBe(false)
  })

  it('rejects non-http schemes and unparseable urls', () => {
    expect(canProxy('file:///etc/passwd', on(['localhost']))).toBe(false)
    expect(canProxy('not a url', on(['localhost']))).toBe(false)
    expect(canProxy('', on(['localhost']))).toBe(false)
  })
})

describe('browserFetchRunner failure classification', () => {
  it('flags corsBlocked only when the probe confirms the host answered', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await browserFetchRunner.run({ method: 'GET', url: 'http://localhost:7799/a', headers: [], body: null })
    expect(result.kind).toBe('failure')
    expect(result.kind === 'failure' && result.corsBlocked).toBe(true)
  })

  it('leaves corsBlocked unset when the host could not be reached', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetchMock)
    const result = await browserFetchRunner.run({ method: 'GET', url: 'http://localhost:59999/a', headers: [], body: null })
    expect(result.kind === 'failure' && result.corsBlocked).toBe(false)
  })
})
