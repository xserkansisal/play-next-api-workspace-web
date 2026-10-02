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
      members: [],
    })
    vi.spyOn(adminApi, 'users').mockResolvedValue({
      users: [{
        id: 'user-1',
        email: 'ada@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
        avatarColor: 'blue',
        systemRole: 'user',
        createdAt: '2026-10-01T10:00:00.000Z',
        hasSignedIn: false,
      }],
      total: 1,
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

    await user.click(screen.getByRole('button', { name: 'Users' }))
    expect(await screen.findByText('Not signed in yet')).toBeInTheDocument()
    expect(screen.getByText('ada@example.com')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Audit log' }))
    expect(await screen.findByText('team.created')).toBeInTheDocument()
    expect(adminApi.auditLog).toHaveBeenCalledWith({ limit: 50, offset: 0 })
  })
})
