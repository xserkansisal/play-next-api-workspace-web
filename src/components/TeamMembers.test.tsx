import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TeamMembers } from '@/components/TeamMembers'
import { workspaceApi } from '@/lib/api'
import type { TeamMember } from '@/lib/teams'

const member: TeamMember = {
  userId: 'user-2',
  email: 'ada@fluttersea.com',
  firstName: 'Ada',
  lastName: 'Lovelace',
  avatarColor: 'blue',
  role: 'viewer',
  joinedAt: '2026-10-01T12:00:00.000Z',
}

describe('team member management', () => {
  afterEach(() => vi.restoreAllMocks())

  it('adds members, changes roles, and removes members using the selected team', async () => {
    const user = userEvent.setup()
    const list = vi.spyOn(workspaceApi, 'teamMembers')
      .mockResolvedValueOnce([])
      .mockResolvedValue([member])
    const add = vi.spyOn(workspaceApi, 'addTeamMember').mockResolvedValue()
    const update = vi.spyOn(workspaceApi, 'updateTeamMember').mockResolvedValue()
    const remove = vi.spyOn(workspaceApi, 'removeTeamMember').mockResolvedValue()
    const onChanged = vi.fn().mockResolvedValue(undefined)

    render(<TeamMembers teamId="team-1" teamName="Game Studio" onChanged={onChanged} />)
    expect(await screen.findByText('No members in this team.')).toBeInTheDocument()
    expect(screen.getByText('0 members')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Email'), 'ada@sisal.com')
    await user.selectOptions(screen.getByLabelText('Role'), 'viewer')
    await user.click(screen.getByRole('button', { name: 'Add member' }))
    expect(add).toHaveBeenCalledWith('team-1', { email: 'ada@sisal.com', role: 'viewer' })
    expect(await screen.findByText('ada@fluttersea.com')).toBeInTheDocument()
    expect(screen.getByText('1 member')).toBeInTheDocument()

    await user.selectOptions(screen.getByRole('combobox', { name: 'Role for ada@fluttersea.com' }), 'owner')
    expect(update).toHaveBeenCalledWith('team-1', 'user-2', 'owner')
    await user.click(screen.getByRole('button', { name: 'Remove ada@fluttersea.com' }))
    expect(remove).toHaveBeenCalledWith('team-1', 'user-2')
    expect(list).toHaveBeenCalledTimes(4)
    expect(onChanged).toHaveBeenCalledTimes(3)
  })

  it('prevents demoting or removing the only team owner', async () => {
    vi.spyOn(workspaceApi, 'teamMembers').mockResolvedValue([{ ...member, role: 'owner' }])
    const update = vi.spyOn(workspaceApi, 'updateTeamMember').mockResolvedValue()
    const remove = vi.spyOn(workspaceApi, 'removeTeamMember').mockResolvedValue()

    render(<TeamMembers teamId="team-1" teamName="Game Studio" onChanged={vi.fn().mockResolvedValue(undefined)} />)

    const roleSelect = await screen.findByRole('combobox', { name: 'Role for ada@fluttersea.com' })
    expect(screen.getByText('The last team owner cannot be demoted or removed. Add another owner first.')).toBeInTheDocument()
    expect(roleSelect.querySelector('option[value="member"]')).toBeDisabled()
    expect(roleSelect.querySelector('option[value="viewer"]')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Remove ada@fluttersea.com' })).toBeDisabled()
    expect(update).not.toHaveBeenCalled()
    expect(remove).not.toHaveBeenCalled()
  })
})
