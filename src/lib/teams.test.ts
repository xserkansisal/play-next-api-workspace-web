import { afterEach, describe, expect, it } from 'vitest'

import { canEditTeam, canManageTeamMembers, chooseActiveTeam, loadActiveTeamId, saveActiveTeamId, setActiveTeamId } from '@/lib/teams'
import type { Team } from '@/lib/teams'

const teams: Team[] = [
  { id: 'team-a', name: 'Alpha', description: '', role: 'member', isMember: true },
  { id: 'team-b', name: 'Beta', description: '', role: 'owner', isMember: true },
]

describe('active team selection', () => {
  afterEach(() => {
    window.localStorage.clear()
    setActiveTeamId(null)
  })

  describe('per-team role capabilities', () => {
    it('allows viewers to read but not edit or manage members, and treats admins as owners', () => {
      expect(canEditTeam('viewer')).toBe(false)
      expect(canManageTeamMembers('member')).toBe(false)
      expect(canEditTeam('member')).toBe(true)
      expect(canManageTeamMembers('owner')).toBe(true)
      expect(canEditTeam('viewer', true)).toBe(true)
      expect(canManageTeamMembers('viewer', true)).toBe(true)
    })
  })

  it('restores a remembered team only while it remains in the signed-in user’s list', () => {
    saveActiveTeamId('user-1', 'team-b')
    expect(chooseActiveTeam('user-1', teams)).toBe('team-b')
    expect(chooseActiveTeam('user-1', [teams[0]!])).toBe('team-a')
    expect(loadActiveTeamId('user-1')).toBe('team-a')
  })

  it('selects the first team by default and clears the selection for an empty list', () => {
    expect(chooseActiveTeam('user-1', teams)).toBe('team-a')
    expect(chooseActiveTeam('user-1', [])).toBeNull()
    expect(loadActiveTeamId('user-1')).toBeNull()
  })
})
