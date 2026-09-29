import { AxiosError, AxiosHeaders } from 'axios'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { apiClient } from '@/lib/api'
import { authApi, authEvents, describeAuthError, onUnauthenticated } from '@/lib/auth'

function authErrorResponse(status: number, code: string, message: string) {
  const config = { headers: new AxiosHeaders() }
  return new AxiosError('Request failed', String(status), config, null, {
    status,
    statusText: 'Error',
    data: { error: { code, message } },
    headers: {},
    config,
  })
}

describe('authApi', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('posts email and code to verify-code and returns the user', async () => {
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: { user: { id: 'u1', email: 'a@sisal.com' }, expiresAt: '2026-10-29T00:00:00.000Z' } })
    const user = await authApi.verifyCode('a@sisal.com', '123456')
    expect(post).toHaveBeenCalledWith('/auth/verify-code', { email: 'a@sisal.com', code: '123456' })
    expect(user).toEqual({ id: 'u1', email: 'a@sisal.com' })
  })

  it('reads the signed-in user from GET /auth/me', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { user: { id: 'u1', email: 'a@sisal.com' } } })
    await expect(authApi.me()).resolves.toEqual({ id: 'u1', email: 'a@sisal.com' })
  })
})

describe('describeAuthError', () => {
  it('surfaces the API error envelope code and message', () => {
    const error = authErrorResponse(400, 'EMAIL_DOMAIN_NOT_ALLOWED', 'That domain cannot sign in.')
    expect(describeAuthError(error)).toEqual({ code: 'EMAIL_DOMAIN_NOT_ALLOWED', message: 'That domain cannot sign in.', status: 400 })
  })

  it('falls back to a network error when there is no response', () => {
    const config = { headers: new AxiosHeaders() }
    const error = new AxiosError('Network Error', 'ERR_NETWORK', config)
    expect(describeAuthError(error).code).toBe('NETWORK_ERROR')
  })
})

describe('unauthenticated event', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('fires only for a 401 with AUTHENTICATION_REQUIRED, not other 401s or errors', async () => {
    const listener = vi.fn()
    const unsubscribe = onUnauthenticated(listener)
    // Mocking apiClient.get directly would bypass axios's own interceptor
    // chain, so the adapter is mocked instead - the response interceptor in
    // lib/auth.ts is wired through axios's real request/response pipeline,
    // and only fires when a request actually flows through it.
    const originalAdapter = apiClient.defaults.adapter
    try {
      const adapter = vi.fn()
        .mockRejectedValueOnce(authErrorResponse(401, 'INVALID_OR_EXPIRED_CODE', 'Wrong code'))
        .mockRejectedValueOnce(authErrorResponse(401, 'AUTHENTICATION_REQUIRED', 'Sign in required'))
      apiClient.defaults.adapter = adapter
      await expect(apiClient.get('/whatever')).rejects.toThrow()
      expect(listener).not.toHaveBeenCalled()
      await expect(apiClient.get('/whatever')).rejects.toThrow()
      expect(listener).toHaveBeenCalledTimes(1)
    } finally {
      apiClient.defaults.adapter = originalAdapter
      unsubscribe()
    }
  })

  it('returns an unsubscribe function that stops future notifications', () => {
    const listener = vi.fn()
    const unsubscribe = onUnauthenticated(listener)
    unsubscribe()
    authEvents.dispatchEvent(new Event('unauthenticated'))
    expect(listener).not.toHaveBeenCalled()
  })
})
