export type TeamRole = 'owner' | 'member' | 'viewer'

export interface Team {
  id: string
  name: string
  description: string
  role: TeamRole
  isMember: boolean
}

export interface TeamMember {
  userId: string
  email: string
  firstName: string
  lastName: string
  avatarUrl?: string | null
  avatarColor: string
  role: TeamRole
  joinedAt: string
}

export function canEditTeam(role: TeamRole | undefined, isSystemAdmin = false): boolean {
  return isSystemAdmin || role === 'owner' || role === 'member'
}

export function canManageTeamMembers(role: TeamRole | undefined, isSystemAdmin = false): boolean {
  return isSystemAdmin || role === 'owner'
}

const activeTeamStoragePrefix = 'play-next-api-workspace.active-team.v1:'
let activeTeamId: string | null = null
export const teamContextEvents = new EventTarget()

export type TeamContextErrorCode = 'TEAM_NOT_FOUND' | 'TEAM_MEMBERSHIP_REQUIRED' | 'TEAM_ROLE_REQUIRED'

export function notifyTeamContextError(code: TeamContextErrorCode, teams?: Team[]): void {
  teamContextEvents.dispatchEvent(new CustomEvent('team-context-error', { detail: { code, teams } }))
}

export function getActiveTeamId(): string | null {
  return activeTeamId
}

export function setActiveTeamId(teamId: string | null): void {
  activeTeamId = teamId
}

export function loadActiveTeamId(userId: string): string | null {
  try {
    return window.localStorage.getItem(`${activeTeamStoragePrefix}${userId}`)
  } catch {
    return null
  }
}

export function saveActiveTeamId(userId: string, teamId: string | null): void {
  try {
    const key = `${activeTeamStoragePrefix}${userId}`
    if (teamId) window.localStorage.setItem(key, teamId)
    else window.localStorage.removeItem(key)
  } catch {
    // Team selection remains available for this session when storage is unavailable.
  }
}

export function chooseActiveTeam(userId: string, teams: Team[]): string | null {
  const remembered = loadActiveTeamId(userId)
  const active = teams.some(({ id }) => id === remembered) ? remembered : teams[0]?.id ?? null
  saveActiveTeamId(userId, active)
  return active
}
