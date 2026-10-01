import { isAxiosError } from 'axios'

import { apiClient } from '@/lib/api'

export interface AuthUser {
  id: string
  email: string
  firstName?: string | null
  lastName?: string | null
  avatarUrl?: string | null
  avatarColor?: string | null
}

export interface UserName {
  firstName: string
  lastName: string
}

function capitalizeNamePart(part: string): string {
  return part ? `${part.charAt(0).toUpperCase()}${part.slice(1)}` : ''
}

export function nameFromEmail(email: string): UserName {
  const localPart = email.split('@', 1)[0] ?? ''
  const parts = localPart.split('.').map((part) => part.trim()).filter(Boolean)
  return {
    firstName: capitalizeNamePart(parts[0] ?? ''),
    lastName: parts.slice(1).map(capitalizeNamePart).join(' '),
  }
}

/**
 * Fired whenever any API call comes back 401 AUTHENTICATION_REQUIRED - the
 * session cookie is missing, expired, or was revoked server-side. Sessions
 * last a month and can be revoked, so this can happen at any point, not just
 * on first load. AuthGate listens for this to decide whether to show the
 * sign-in screen (nothing was loaded yet) or an overlay on top of the
 * still-mounted app (so in-memory drafts are not lost).
 */
export const authEvents = new EventTarget()

function isAuthenticationRequired(error: unknown): boolean {
  if (!isAxiosError<{ error?: { code?: string } }>(error)) return false
  return error.response?.status === 401 && error.response.data?.error?.code === 'AUTHENTICATION_REQUIRED'
}

apiClient.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (isAuthenticationRequired(error)) {
      authEvents.dispatchEvent(new Event('unauthenticated'))
    }
    return Promise.reject(error)
  },
)

export function onUnauthenticated(listener: () => void): () => void {
  authEvents.addEventListener('unauthenticated', listener)
  return () => authEvents.removeEventListener('unauthenticated', listener)
}

export interface AuthErrorInfo {
  code: string
  message: string
  status?: number
}

/**
 * Every auth error the API returns (domain rejected, wrong/expired code,
 * rate limited, delivery failure, plain validation failure) uses the same
 * `{ error: { code, message } }` envelope as the rest of the API. This reads
 * that envelope instead of guessing from the HTTP status alone, since
 * several of these share a status code (e.g. invalid vs. expired vs.
 * attempts-exhausted codes are all a 401 with the same
 * INVALID_OR_EXPIRED_CODE - see authApi.verifyCode's doc comment).
 */
export function describeAuthError(error: unknown): AuthErrorInfo {
  if (isAxiosError<{ error?: { code?: string; message?: string } }>(error)) {
    const apiError = error.response?.data?.error
    if (apiError?.code) {
      return { code: apiError.code, message: apiError.message ?? 'Something went wrong.', status: error.response?.status }
    }
    if (!error.response) {
      return { code: 'NETWORK_ERROR', message: 'Unable to reach the server. Check your connection and try again.' }
    }
    return { code: 'HTTP_ERROR', message: `Unexpected error (${error.response.status}).` }
  }
  return { code: 'UNKNOWN', message: error instanceof Error ? error.message : 'Unknown error' }
}

export const authApi = {
  /** POST /api/v1/auth/request-code. Always 202 for an allowed domain, regardless of whether the address has an account - the API deliberately keeps this response uniform. A disallowed domain is the one case it rejects outright (400 EMAIL_DOMAIN_NOT_ALLOWED), since the domain rule is public anyway. */
  async requestCode(email: string): Promise<void> {
    await apiClient.post('/auth/request-code', { email })
  },
  /**
   * POST /api/v1/auth/verify-code. On success, the API sets the session
   * cookie itself via `Set-Cookie` - this client cannot and does not need to
   * read or store it, since it's HttpOnly.
   *
   * IMPORTANT asymmetry in what the API discloses: a wrong code, an expired
   * code, and a code that has hit its 5-attempt limit all come back as the
   * *same* 401 `INVALID_OR_EXPIRED_CODE` - the API does not say which. Only
   * "too many verify attempts across the 15-minute window" is distinguished,
   * as 429 `AUTH_RATE_LIMITED`. Callers that want to tell a user "this code
   * is now dead, request a new one" have to track attempts against this
   * specific code client-side (see SignIn.tsx) - the server will not tell
   * them.
   */
  async verifyCode(email: string, code: string): Promise<AuthUser> {
    const { data } = await apiClient.post<{ user: AuthUser; expiresAt: string }>('/auth/verify-code', { email, code })
    return data.user
  },
  /** GET /api/v1/auth/me. Requires the session cookie; 401s like any other protected route if it's missing/expired/revoked. */
  async me(): Promise<AuthUser> {
    const { data } = await apiClient.get<{ user: AuthUser }>('/auth/me')
    return data.user
  },
  async uploadAvatar(file: File): Promise<AuthUser> {
    const form = new FormData()
    form.append('avatar', file)
    const { data } = await apiClient.post<{ user: AuthUser }>('/auth/me/avatar', form)
    return data.user
  },
  async removeAvatar(): Promise<AuthUser> {
    const { data } = await apiClient.delete<{ user: AuthUser }>('/auth/me/avatar')
    return data.user
  },
  async setAvatarColor(avatarColor: string): Promise<AuthUser> {
    const { data } = await apiClient.patch<{ user: AuthUser }>('/auth/me/profile', { avatarColor })
    return data.user
  },
  /** POST /api/v1/auth/sign-out. Revokes the session server-side and expires the cookie. Safe to call even if already signed out. */
  async signOut(): Promise<void> {
    await apiClient.post('/auth/sign-out')
  },
}
