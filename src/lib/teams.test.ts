import { afterEach, describe, expect, it } from 'vitest'

import { chooseActiveTeam, loadActiveTeamId, saveActiveTeamId, setActiveTeamId } from '@/lib/teams'
import type { Team } from '@/lib/teams'

const teams: Team[] = [
  { id: 'team-a', name: 'Alpha', description: '', role: 'member' },
  { id: 'team-b', name: 'Beta', description: '', role: 'owner' },
]

describe('active team selection', () => {
  afterEach(() => {
    window.localStorage.clear()
    setActiveTeamId(null)
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
