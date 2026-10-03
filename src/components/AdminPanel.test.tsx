import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AdminPanel } from '@/components/AdminPanel'
import { adminApi } from '@/lib/admin'

describe('AdminPanel', () => {
  afterEach(() => vi.restoreAllMocks())

  it('loads team administration and displays users and audit entries in their sections', async () => {
    vi.spyOn(adminApi, 'teams').mockResolvedValue([{
      id: 'team-1',
      name: 'Game Studio',
      description: 'Existing workspace',
      memberCount: 1,
      createdAt: '2026-10-01T10:00:00.000Z',
      updatedAt: '2026-10-01T10:00:00.000Z',
      archivedAt: null,
    }])
    vi.spyOn(adminApi, 'team').mockResolvedValue({
      id: 'team-1',
      name: 'Game Studio',
      description: 'Existing workspace',
      memberCount: 1,
      createdAt: '2026-10-01T10:00:00.000Z',
      updatedAt: '2026-10-01T10:00:00.000Z',
      archivedAt: null,
      members: [{
        userId: 'owner-1',
        email: 'owner@example.com',
        firstName: 'Team',
        lastName: 'Owner',
        avatarColor: 'blue',
        role: 'owner',
        joinedAt: '2026-10-01T10:00:00.000Z',
      }],
    })
    vi.spyOn(adminApi, 'users').mockResolvedValue({
      users: [{
        id: 'user-1',
        email: 'ada@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
        avatarUrl: 'https://api.example.com/avatars/ada.png',
        avatarColor: 'blue',
        systemRole: 'user',
        createdAt: '2026-10-01T10:00:00.000Z',
        hasSignedIn: false,
      }],
      total: 1,
    })
    vi.spyOn(adminApi, 'user').mockResolvedValue({
      id: 'user-1',
      email: 'ada@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
      avatarUrl: 'https://api.example.com/avatars/ada.png',
      avatarColor: 'blue',
      systemRole: 'user',
      createdAt: '2026-10-01T10:00:00.000Z',
      hasSignedIn: false,
      teams: [],
    })
    const updateUser = vi.spyOn(adminApi, 'updateUser').mockResolvedValue({
      id: 'user-1',
      email: 'ada@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
      avatarUrl: 'https://api.example.com/avatars/ada.png',
      avatarColor: 'blue',
      systemRole: 'admin',
      createdAt: '2026-10-01T10:00:00.000Z',
      hasSignedIn: false,
      teams: [],
    })
    vi.spyOn(adminApi, 'auditLog').mockResolvedValue({
      entries: [{
        id: 'event-1',
        actor: 'admin@example.com',
        action: 'team.created',
        targetType: 'team',
        targetId: 'team-1',
        teamId: 'team-1',
        details: {},
        createdAt: '2026-10-01T10:00:00.000Z',
      }],
      total: 1,
    })

    const user = userEvent.setup()
    render(<AdminPanel currentUserId="admin-1" onClose={vi.fn()} onAdminRequired={vi.fn()} />)
    expect(await screen.findByRole('button', { name: 'Game Studio' })).toBeInTheDocument()
    await waitFor(() => expect(adminApi.team).toHaveBeenCalledWith('team-1'))
    expect(screen.getByText('The last team owner cannot be demoted or removed. Add another owner first.')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Role for owner@example.com' }).querySelector('option[value="member"]')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Remove' })).toBeDisabled()

    await user.click(screen.getByRole('button', { name: 'Users' }))
    expect(await screen.findByText('Not signed in')).toBeInTheDocument()
    expect(screen.getByText('ada@example.com')).toBeInTheDocument()
    expect(document.querySelector('.admin-user-cell img')).toHaveAttribute('src', 'https://api.example.com/avatars/ada.png')
    expect(screen.getByText('User', { selector: '.admin-role-badge' })).toBeInTheDocument()
    expect(screen.getByText('Not signed in', { selector: '.admin-account-status' })).toBeInTheDocument()
    expect(document.querySelector('.admin-users-layout')).not.toHaveClass('has-selection')
    await user.click(screen.getByRole('button', { name: 'Manage Ada Lovelace' }))
    expect(await screen.findByText('Not a member of any team.')).toBeInTheDocument()
    expect(document.querySelector('.admin-users-layout')).toHaveClass('has-selection')
    await user.selectOptions(screen.getByRole('combobox', { name: 'System role' }), 'admin')
    await waitFor(() => expect(updateUser).toHaveBeenCalledWith('user-1', 'admin'))

    await user.click(screen.getByRole('button', { name: 'Audit log' }))
    expect(await screen.findByText('team.created')).toBeInTheDocument()
    expect(screen.getByText('Team created', { selector: '.admin-audit-action' })).toBeInTheDocument()
    expect(adminApi.auditLog).toHaveBeenCalledWith({ limit: 50, offset: 0 })
  })

  it('shows the last-system-admin safeguard returned by the API', async () => {
    vi.spyOn(adminApi, 'teams').mockResolvedValue([])
    vi.spyOn(adminApi, 'users').mockResolvedValue({
      users: [{
        id: 'admin-1',
        email: 'admin@example.com',
        firstName: 'System',
        lastName: 'Admin',
        avatarColor: 'blue',
        systemRole: 'admin',
        createdAt: '2026-10-01T10:00:00.000Z',
        hasSignedIn: true,
      }],
      total: 1,
    })
    vi.spyOn(adminApi, 'user').mockResolvedValue({
      id: 'admin-1',
      email: 'admin@example.com',
      firstName: 'System',
      lastName: 'Admin',
      avatarColor: 'blue',
      systemRole: 'admin',
      createdAt: '2026-10-01T10:00:00.000Z',
      hasSignedIn: true,
      teams: [],
    })
    vi.spyOn(adminApi, 'updateUser').mockRejectedValue({
      isAxiosError: true,
      response: { data: { error: { code: 'LAST_SYSTEM_ADMIN', message: 'Cannot remove the last admin' } } },
    })

    const user = userEvent.setup()
    render(<AdminPanel currentUserId="admin-1" onClose={vi.fn()} onAdminRequired={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: 'Users' }))
    await user.click(await screen.findByRole('button', { name: 'Manage System Admin' }))
    expect(screen.getByText('If you are the last system admin, you cannot remove your own admin role.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete user' })).toBeDisabled()
    expect(screen.getByText('You cannot delete your own account.')).toBeInTheDocument()
    await user.selectOptions(screen.getByRole('combobox', { name: 'System role' }), 'user')

    expect(await screen.findByText(/The last system admin cannot remove their own admin role\./, { selector: '.admin-field-error' })).toBeInTheDocument()
  })

  function mockDeletableUser() {
    const ada = {
      id: 'user-1',
      email: 'ada@example.com',
      firstName: 'Ada',
      lastName: 'Lovelace',
      avatarColor: 'blue',
      systemRole: 'user' as const,
      createdAt: '2026-10-01T10:00:00.000Z',
      hasSignedIn: true,
    }
    vi.spyOn(adminApi, 'teams').mockResolvedValue([])
    const users = vi.spyOn(adminApi, 'users')
      .mockResolvedValueOnce({ users: [ada], total: 1 })
      .mockResolvedValue({ users: [], total: 0 })
    vi.spyOn(adminApi, 'user').mockResolvedValue({
      ...ada,
      teams: [{ id: 'team-1', name: 'Game Studio', role: 'owner', archivedAt: null }],
    })
    return { users }
  }

  it('deletes a user after confirmation and refreshes the list', async () => {
    const { users } = mockDeletableUser()
    const deleteUser = vi.spyOn(adminApi, 'deleteUser').mockResolvedValue()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)

    const user = userEvent.setup()
    render(<AdminPanel currentUserId="admin-1" onClose={vi.fn()} onAdminRequired={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: 'Users' }))
    await user.click(await screen.findByRole('button', { name: 'Manage Ada Lovelace' }))
    expect(screen.getByText(/Owns Game Studio\./)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Delete user' }))

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('Permanently delete Ada Lovelace (ada@example.com)?'))
    await waitFor(() => expect(deleteUser).toHaveBeenCalledWith('user-1'))
    expect(await screen.findByText('Ada Lovelace was deleted.')).toBeInTheDocument()
    expect(users).toHaveBeenCalledTimes(2)
    expect(adminApi.teams).toHaveBeenCalledTimes(2)
    expect(screen.queryByRole('button', { name: 'Manage Ada Lovelace' })).not.toBeInTheDocument()
    expect(document.querySelector('.admin-user-detail')).not.toBeInTheDocument()
  })

  it('does not delete a user when confirmation is cancelled', async () => {
    mockDeletableUser()
    const deleteUser = vi.spyOn(adminApi, 'deleteUser').mockResolvedValue()
    vi.spyOn(window, 'confirm').mockReturnValue(false)

    const user = userEvent.setup()
    render(<AdminPanel currentUserId="admin-1" onClose={vi.fn()} onAdminRequired={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: 'Users' }))
    await user.click(await screen.findByRole('button', { name: 'Manage Ada Lovelace' }))
    await user.click(screen.getByRole('button', { name: 'Delete user' }))
    expect(deleteUser).not.toHaveBeenCalled()
  })

  it.each([
    ['CANNOT_DELETE_SELF', /You cannot delete your own account\. Ask another system admin/],
    ['LAST_SYSTEM_ADMIN', /Ada Lovelace is the only system admin\. Promote another admin first\./],
  ])('shows a friendly message when deletion fails with %s', async (code, message) => {
    mockDeletableUser()
    vi.spyOn(adminApi, 'deleteUser').mockRejectedValue({
      isAxiosError: true,
      response: { status: 409, data: { error: { code, message: 'Rejected' } } },
    })
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    const user = userEvent.setup()
    render(<AdminPanel currentUserId="admin-1" onClose={vi.fn()} onAdminRequired={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: 'Users' }))
    await user.click(await screen.findByRole('button', { name: 'Manage Ada Lovelace' }))
    await user.click(screen.getByRole('button', { name: 'Delete user' }))

    expect(await screen.findByText(message, { selector: '.admin-field-error' })).toBeInTheDocument()
    expect(document.querySelector('.admin-user-detail')).toBeInTheDocument()
  })

  it('names the team blocking deletion and links to it', async () => {
    mockDeletableUser()
    const team = vi.spyOn(adminApi, 'team').mockResolvedValue({
      id: 'team-1', name: 'Game Studio', description: '', memberCount: 1,
      createdAt: '2026-10-01T10:00:00.000Z', updatedAt: '2026-10-01T10:00:00.000Z', archivedAt: null, members: [],
    })
    vi.spyOn(adminApi, 'deleteUser').mockRejectedValue({
      isAxiosError: true,
      response: { status: 409, data: { error: { code: 'TEAM_LAST_OWNER', message: 'Rejected', details: { teamId: 'team-1' } } } },
    })
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    const user = userEvent.setup()
    render(<AdminPanel currentUserId="admin-1" onClose={vi.fn()} onAdminRequired={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: 'Users' }))
    await user.click(await screen.findByRole('button', { name: 'Manage Ada Lovelace' }))
    await user.click(screen.getByRole('button', { name: 'Delete user' }))

    expect(await screen.findByText('Ada Lovelace is the only owner of Game Studio. Assign another owner to Game Studio first.', { selector: '.admin-field-error' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Open Game Studio' }))
    await waitFor(() => expect(team).toHaveBeenCalledWith('team-1'))
    expect(screen.getByRole('button', { name: 'Teams', current: 'page' })).toBeInTheDocument()
  })

  it('closes the detail and refreshes the list when the user is already gone', async () => {
    const { users } = mockDeletableUser()
    vi.spyOn(adminApi, 'deleteUser').mockRejectedValue({
      isAxiosError: true,
      response: { status: 404, data: { error: { code: 'USER_NOT_FOUND', message: 'Not found' } } },
    })
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    const user = userEvent.setup()
    render(<AdminPanel currentUserId="admin-1" onClose={vi.fn()} onAdminRequired={vi.fn()} />)
    await user.click(await screen.findByRole('button', { name: 'Users' }))
    await user.click(await screen.findByRole('button', { name: 'Manage Ada Lovelace' }))
    await user.click(screen.getByRole('button', { name: 'Delete user' }))

    expect(await screen.findByText('This user no longer exists. The user list was refreshed.')).toBeInTheDocument()
    await waitFor(() => expect(users).toHaveBeenCalledTimes(2))
    expect(document.querySelector('.admin-user-detail')).not.toBeInTheDocument()
  })
})
