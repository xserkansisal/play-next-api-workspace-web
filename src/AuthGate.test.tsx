import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AxiosError, AxiosHeaders } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AuthGate } from '@/AuthGate'
import { workspaceApi } from '@/lib/api'
import { adminApi } from '@/lib/admin'
import { authApi, authEvents, teamsApi } from '@/lib/auth'
import { notifyTeamContextError } from '@/lib/teams'
import type { Team } from '@/lib/teams'

const team: Team = { id: 'team-1', name: 'Game Studio', description: '', role: 'member', isMember: true }

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
  static current: MockEventSource
  readonly url: string
  onopen: (() => void) | null = null
  onmessage: (() => void) | null = null
  onerror: (() => void) | null = null
  close = vi.fn()
  constructor(url: string) {
    super()
    this.url = url
    MockEventSource.current = this
  }
}

describe('AuthGate', () => {
  beforeEach(() => {
    vi.stubGlobal('EventSource', MockEventSource)
    window.localStorage.clear()
    vi.spyOn(teamsApi, 'list').mockResolvedValue([team])
    vi.spyOn(workspaceApi, 'proxySettings').mockResolvedValue({ enabled: false, anyHost: false, allowedHosts: [] })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('shows sign-in when there is no valid session, and mounts the app after verifying a code', async () => {
    vi.spyOn(authApi, 'me').mockRejectedValueOnce(unauthenticatedError())
    vi.spyOn(authApi, 'requestCode').mockResolvedValue('a@fluttersea.com')
    vi.spyOn(authApi, 'verifyCode').mockResolvedValue({ id: 'u1', email: 'a@fluttersea.com' })
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

    expect(await screen.findByText('a@fluttersea.com')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /a@fluttersea\.com/i }))
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
    expect(teamsApi.list).toHaveBeenCalledOnce()
  })

  it('shows the no-team screen when the signed-in user has no team memberships', async () => {
    vi.spyOn(authApi, 'me').mockResolvedValue({ id: 'u1', email: 'a@sisal.com' })
    vi.mocked(teamsApi.list).mockResolvedValue([])

    render(<AuthGate />)

    expect(await screen.findByText('No team yet')).toBeInTheDocument()
    expect(screen.getByText(/ask an administrator to add you/i)).toBeInTheDocument()
  })

  it('lets a system admin open the admin panel without belonging to a team', async () => {
    vi.spyOn(authApi, 'me').mockResolvedValue({ id: 'u1', email: 'admin@sisal.com', systemRole: 'admin' })
    vi.mocked(teamsApi.list).mockResolvedValue([])
    vi.spyOn(adminApi, 'teams').mockResolvedValue([])
    const user = userEvent.setup()
    render(<AuthGate />)

    await user.click(await screen.findByRole('button', { name: 'Open admin panel' }))

    expect(await screen.findByRole('heading', { name: 'Admin panel' })).toBeInTheDocument()
    expect(adminApi.teams).toHaveBeenCalledOnce()
  })

  it('keeps workspace drafts mounted while the admin panel is open', async () => {
    vi.spyOn(authApi, 'me').mockResolvedValue({ id: 'u1', email: 'admin@sisal.com', systemRole: 'admin' })
    vi.mocked(teamsApi.list).mockResolvedValue([team])
    vi.spyOn(workspaceApi, 'collections').mockResolvedValue([{
      id: 'collection-1',
      name: 'Commerce API',
      description: '',
      items: [{
        id: 'request-1',
        collectionId: 'collection-1',
        parentId: null,
        type: 'request',
        name: 'List orders',
        description: '',
        method: 'GET',
        url: '/orders',
        queryParams: [],
        headers: [],
        body: null,
        auth: { type: 'none' },
      }],
    }])
    vi.spyOn(workspaceApi, 'collection').mockResolvedValue({
      id: 'collection-1',
      name: 'Commerce API',
      description: '',
      items: [{
        id: 'request-1',
        collectionId: 'collection-1',
        parentId: null,
        type: 'request',
        name: 'List orders',
        description: '',
        method: 'GET',
        url: '/orders',
        queryParams: [],
        headers: [],
        body: null,
        auth: { type: 'none' },
      }],
    })
    vi.spyOn(workspaceApi, 'environments').mockResolvedValue([])
    vi.spyOn(workspaceApi, 'trash').mockResolvedValue([])
    vi.spyOn(workspaceApi, 'variables').mockResolvedValue([])
    vi.spyOn(adminApi, 'teams').mockResolvedValue([])
    const user = userEvent.setup()
    render(<AuthGate />)

    await user.click(await screen.findByRole('button', { name: 'List orders' }))
    const url = screen.getByRole('textbox', { name: 'Request URL' })
    await user.clear(url)
    await user.type(url, '/local-draft')
    await user.click(screen.getByRole('button', { name: 'Admin' }))
    expect(await screen.findByRole('heading', { name: 'Admin panel' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Back to workspace' }))

    expect(screen.getByRole('textbox', { name: 'Request URL' })).toHaveValue('/local-draft')
  })

  it('leaves the admin panel immediately when the API rejects the admin role', async () => {
    vi.spyOn(authApi, 'me').mockResolvedValue({ id: 'u1', email: 'admin@sisal.com', systemRole: 'admin' })
    vi.mocked(teamsApi.list).mockResolvedValue([])
    vi.spyOn(adminApi, 'teams').mockRejectedValue({
      response: { status: 403, data: { error: { code: 'ADMIN_REQUIRED', message: 'Admin required' } } },
      isAxiosError: true,
    })
    const user = userEvent.setup()
    render(<AuthGate />)

    await user.click(await screen.findByRole('button', { name: 'Open admin panel' }))

    expect(await screen.findByText('No team yet')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Admin panel' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Open admin panel' })).not.toBeInTheDocument()
  })

  it('switches teams, closes the previous stream, and opens a fresh team-scoped stream', async () => {
    vi.spyOn(authApi, 'me').mockResolvedValue({ id: 'u1', email: 'a@sisal.com' })
    vi.mocked(teamsApi.list).mockResolvedValue([
      team,
      { id: 'team-2', name: 'Mobile Gaming', description: '', role: 'owner', isMember: true },
    ])
    const user = userEvent.setup()
    render(<AuthGate />)

    const picker = await screen.findByRole('combobox', { name: 'Team' })
    expect(MockEventSource.current.url).toContain('?teamId=team-1')
    const previousStream = MockEventSource.current

    await user.click(picker)
    await user.click(screen.getByRole('option', { name: /Mobile Gaming/ }))

    await waitFor(() => expect(MockEventSource.current.url).toContain('?teamId=team-2'))
    expect(previousStream.close).toHaveBeenCalled()
    expect(window.localStorage.getItem('play-next-api-workspace.active-team.v1:u1')).toBe('team-2')
  })

  it('switches away from a team after the server reports that access was removed', async () => {
    vi.spyOn(authApi, 'me').mockResolvedValue({ id: 'u1', email: 'a@sisal.com' })
    vi.mocked(teamsApi.list)
      .mockResolvedValueOnce([team])
      .mockResolvedValueOnce([{ id: 'team-2', name: 'Mobile Gaming', description: '', role: 'member', isMember: true }])
    render(<AuthGate />)
    await screen.findByRole('combobox', { name: 'Team' })

    notifyTeamContextError('TEAM_NOT_FOUND')

    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Team' })).toHaveAttribute('aria-valuetext', 'Mobile Gaming'))
    expect(await screen.findByText(/no longer have access to Game Studio/i)).toBeInTheDocument()
    expect(MockEventSource.current.url).toContain('?teamId=team-2')
  })

  it('shows the no-team state after membership-required and an empty refreshed team list', async () => {
    vi.spyOn(authApi, 'me').mockResolvedValue({ id: 'u1', email: 'a@sisal.com' })
    vi.mocked(teamsApi.list).mockResolvedValueOnce([team]).mockResolvedValueOnce([])
    render(<AuthGate />)
    await screen.findByRole('combobox', { name: 'Team' })

    notifyTeamContextError('TEAM_MEMBERSHIP_REQUIRED')

    expect(await screen.findByText('No team yet')).toBeInTheDocument()
  })

  it('refreshes per-team roles after TEAM_ROLE_REQUIRED and shows the permission message', async () => {
    vi.spyOn(authApi, 'me').mockResolvedValue({ id: 'u1', email: 'a@sisal.com' })
    vi.mocked(teamsApi.list)
      .mockResolvedValueOnce([team])
      .mockResolvedValueOnce([{ ...team, role: 'viewer' }])
    vi.spyOn(workspaceApi, 'collections').mockResolvedValue([])
    vi.spyOn(workspaceApi, 'environments').mockResolvedValue([])
    vi.spyOn(workspaceApi, 'trash').mockResolvedValue([])
    vi.spyOn(workspaceApi, 'variables').mockResolvedValue([])
    render(<AuthGate />)
    await screen.findByRole('combobox', { name: 'Team' })

    notifyTeamContextError('TEAM_ROLE_REQUIRED')

    expect(await screen.findByText('You do not have permission in this team.')).toBeInTheDocument()
    expect(teamsApi.list).toHaveBeenCalledTimes(2)
  })

  it('uses the team-list probe from a failed SSE connection without issuing a duplicate refresh', async () => {
    vi.spyOn(authApi, 'me').mockResolvedValue({ id: 'u1', email: 'a@sisal.com' })
    vi.mocked(teamsApi.list).mockResolvedValueOnce([team]).mockResolvedValueOnce([])
    render(<AuthGate />)
    await screen.findByRole('combobox', { name: 'Team' })

    MockEventSource.current.onerror?.()

    expect(await screen.findByText('No team yet')).toBeInTheDocument()
    expect(teamsApi.list).toHaveBeenCalledTimes(2)
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
