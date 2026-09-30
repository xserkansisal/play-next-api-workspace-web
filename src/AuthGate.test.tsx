import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AxiosError, AxiosHeaders } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthGate } from '@/AuthGate'
import { workspaceApi } from '@/lib/api'
import { authApi, authEvents } from '@/lib/auth'

function unauthenticatedError() {
  const config = { headers: new AxiosHeaders() }
  return new AxiosError('Request failed', '401', config, null, {
    status: 401,
    statusText: 'Unauthorized',
    data: { error: { code: 'AUTHENTICATION_REQUIRED', message: 'Sign in required' } },
    headers: {},
    config,
  })
}

class MockEventSource extends EventTarget {
  onopen: (() => void) | null = null
  onmessage: (() => void) | null = null
  onerror: (() => void) | null = null
  close = vi.fn()
  constructor(_url: string) { super() }
}

describe('AuthGate', () => {
  beforeEach(() => {
    vi.stubGlobal('EventSource', MockEventSource)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('shows sign-in when there is no valid session, and mounts the app after verifying a code', async () => {
    vi.spyOn(authApi, 'me').mockRejectedValueOnce(unauthenticatedError())
    vi.spyOn(authApi, 'requestCode').mockResolvedValue(undefined)
    vi.spyOn(authApi, 'verifyCode').mockResolvedValue({ id: 'u1', email: 'a@sisal.com' })
    vi.spyOn(workspaceApi, 'collections').mockResolvedValue([])
    vi.spyOn(workspaceApi, 'environments').mockResolvedValue([])
    vi.spyOn(workspaceApi, 'trash').mockResolvedValue([])
    vi.spyOn(workspaceApi, 'variables').mockResolvedValue([])

    const user = userEvent.setup()
    render(<AuthGate />)
    await screen.findByLabelText('Email')
    await user.type(screen.getByLabelText('Email'), 'a@sisal.com')
    await user.click(screen.getByRole('button', { name: 'Send code' }))
    await user.type(await screen.findByLabelText('6-digit code'), '123456')
    await user.click(screen.getByRole('button', { name: 'Verify code' }))

    expect(await screen.findByText('a@sisal.com')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
  })

  it('goes straight to the app when a valid session already exists', async () => {
    vi.spyOn(authApi, 'me').mockResolvedValue({ id: 'u1', email: 'a@sisal.com' })
    vi.spyOn(workspaceApi, 'collections').mockResolvedValue([])
    vi.spyOn(workspaceApi, 'environments').mockResolvedValue([])
    vi.spyOn(workspaceApi, 'trash').mockResolvedValue([])
    vi.spyOn(workspaceApi, 'variables').mockResolvedValue([])

    render(<AuthGate />)
    expect(await screen.findByText('a@sisal.com')).toBeInTheDocument()
  })

  it('shows a session-expired overlay on a mid-session 401 without unmounting the app', async () => {
    vi.spyOn(authApi, 'me').mockResolvedValue({ id: 'u1', email: 'a@sisal.com' })
    vi.spyOn(workspaceApi, 'collections').mockResolvedValue([])
    vi.spyOn(workspaceApi, 'environments').mockResolvedValue([])
    vi.spyOn(workspaceApi, 'trash').mockResolvedValue([])
    vi.spyOn(workspaceApi, 'variables').mockResolvedValue([])

    render(<AuthGate />)
    await screen.findByText('a@sisal.com')

    // Simulate a mid-session request coming back 401, as would happen if the
    // session was revoked or expired while the app was already open. The
    // interceptor wiring itself (a real 401 response -> this event) is
    // covered separately in lib/auth.test.ts; here we only need AuthGate's
    // reaction to the event.
    authEvents.dispatchEvent(new Event('unauthenticated'))

    expect(await screen.findByText(/session has expired/i)).toBeInTheDocument()
    // The app underneath is still mounted, not replaced - unsaved drafts are preserved.
    expect(screen.getByText('a@sisal.com')).toBeInTheDocument()
  })
})
