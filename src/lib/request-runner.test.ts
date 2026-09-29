import { afterEach, describe, expect, it, vi } from 'vitest'

import { browserFetchRunner } from '@/lib/request-runner'

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

  it('describes a thrown fetch failure without asserting a specific unobservable cause', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    const result = await browserFetchRunner.run({ method: 'GET', url: 'https://blocked.example', headers: [], body: null })

    expect(result.kind).toBe('failure')
    if (result.kind === 'failure') {
      expect(result.message).toContain('Failed to fetch')
      // Must present CORS/reachability as possibilities, not a confirmed diagnosis.
      expect(result.message.toLowerCase()).toContain('cors')
      expect(result.message.toLowerCase()).toMatch(/does not tell|not.*confirmed/)
    }
  })
})
