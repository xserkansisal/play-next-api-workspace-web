import { AxiosError, AxiosHeaders } from 'axios'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { apiClient } from '@/lib/api'
import { authApi, authEvents, describeAuthError, nameFromEmail, onUnauthenticated } from '@/lib/auth'
import { getActiveTeamId, setActiveTeamId, teamContextEvents } from '@/lib/teams'

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
    setActiveTeamId(null)
  })

  it('includes credentials on API requests so the browser sends the session cookie', () => {
    expect(apiClient.defaults.withCredentials).toBe(true)
  })

  it('adds the active team header to API requests', async () => {
    setActiveTeamId('team-1')
    const adapter = vi.fn(async (config) => ({
      config,
      data: {},
      headers: new AxiosHeaders(),
      status: 200,
      statusText: 'OK',
    }))

    await apiClient.get('/teams', { adapter })

    expect(adapter.mock.calls[0]?.[0].headers.get('X-Team-Id')).toBe('team-1')
    expect(getActiveTeamId()).toBe('team-1')
  })

  it('announces team-context errors from API responses to the app shell', async () => {
    const listener = vi.fn()
    teamContextEvents.addEventListener('team-context-error', listener)
    setActiveTeamId('team-1')
    const headers = new AxiosHeaders({ 'X-Team-Id': 'team-1' })
    const config = { headers, url: '/collections' }
    const failure = new AxiosError('Not found', '404', config, null, {
      status: 404,
      statusText: 'Not Found',
      data: { error: { code: 'TEAM_NOT_FOUND', message: 'Team not found' } },
      headers: {},
      config,
    })

    await expect(apiClient.get('/collections', { adapter: () => Promise.reject(failure) })).rejects.toBe(failure)

    expect(listener).toHaveBeenCalledOnce()
    expect((listener.mock.calls[0]?.[0] as CustomEvent<{ code: string }>).detail.code).toBe('TEAM_NOT_FOUND')
    teamContextEvents.removeEventListener('team-context-error', listener)
  })

  it('does not treat an admin target 404 as loss of the selected workspace team', async () => {
    const listener = vi.fn()
    teamContextEvents.addEventListener('team-context-error', listener)
    setActiveTeamId('team-1')
    const config = { headers: new AxiosHeaders({ 'X-Team-Id': 'team-1' }), url: '/admin/teams/missing' }
    const failure = new AxiosError('Not found', '404', config, null, {
      status: 404,
      statusText: 'Not Found',
      data: { error: { code: 'TEAM_NOT_FOUND', message: 'Team not found' } },
      headers: {},
      config,
    })

    await expect(apiClient.get('/admin/teams/missing', { adapter: () => Promise.reject(failure) })).rejects.toBe(failure)

    expect(listener).not.toHaveBeenCalled()
    teamContextEvents.removeEventListener('team-context-error', listener)
  })

  it('posts email to dev-login and returns the signed-in user', async () => {
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: { user: { id: 'u1', email: 'a@sisal.com' }, expiresAt: '2026-10-29T00:00:00.000Z' } })
    const user = await authApi.devLogin('a@sisal.com')
    expect(post).toHaveBeenCalledWith('/auth/dev-login', { email: 'a@sisal.com' })
    expect(user).toEqual({ id: 'u1', email: 'a@sisal.com' })
  })

  it('posts email and code to verify-code and returns the user', async () => {
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: { user: { id: 'u1', email: 'a@sisal.com' }, expiresAt: '2026-10-29T00:00:00.000Z' } })
    const user = await authApi.verifyCode('a@sisal.com', '123456')
    expect(post).toHaveBeenCalledWith('/auth/verify-code', { email: 'a@sisal.com', code: '123456' })
    expect(user).toEqual({ id: 'u1', email: 'a@sisal.com' })
  })

  it('reads the signed-in user from GET /auth/me', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({ data: { user: { id: 'u1', email: 'a@sisal.com', firstName: 'Ada', lastName: 'Lovelace' } } })
    await expect(authApi.me()).resolves.toEqual({ id: 'u1', email: 'a@sisal.com', firstName: 'Ada', lastName: 'Lovelace' })
  })

  it('uploads and removes the authenticated user avatar', async () => {
    const file = new File(['image'], 'avatar.png', { type: 'image/png' })
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: { user: { id: 'u1', email: 'a@sisal.com', avatarUrl: '/media/u1.png' } } })
    const remove = vi.spyOn(apiClient, 'delete').mockResolvedValue({ data: { user: { id: 'u1', email: 'a@sisal.com', avatarUrl: null } } })

    await expect(authApi.uploadAvatar(file)).resolves.toMatchObject({ avatarUrl: '/media/u1.png' })
    expect(post).toHaveBeenCalledWith('/auth/me/avatar', expect.any(FormData))
    expect((post.mock.calls[0]?.[1] as FormData).get('avatar')).toBe(file)
    await expect(authApi.removeAvatar()).resolves.toMatchObject({ avatarUrl: null })
    expect(remove).toHaveBeenCalledWith('/auth/me/avatar')
  })

  it('saves the chosen fallback avatar color', async () => {
    const patch = vi.spyOn(apiClient, 'patch').mockResolvedValue({ data: { user: { id: 'u1', email: 'a@sisal.com', avatarColor: 'green' } } })
    await expect(authApi.setAvatarColor('green')).resolves.toMatchObject({ avatarColor: 'green' })
    expect(patch).toHaveBeenCalledWith('/auth/me/profile', { avatarColor: 'green' })
  })
})

describe('nameFromEmail', () => {
  it('uses the first local-part segment as the first name and the rest as the last name', () => {
    expect(nameFromEmail('serkan.taghan@sisal.com')).toEqual({ firstName: 'Serkan', lastName: 'Taghan' })
    expect(nameFromEmail('ada.marie.lovelace@example.com')).toEqual({ firstName: 'Ada', lastName: 'Marie Lovelace' })
  })

  it('handles a single segment and ignores empty dot-separated segments', () => {
    expect(nameFromEmail('serkan@sisal.com')).toEqual({ firstName: 'Serkan', lastName: '' })
    expect(nameFromEmail('.serkan..taghan.@sisal.com')).toEqual({ firstName: 'Serkan', lastName: 'Taghan' })
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
