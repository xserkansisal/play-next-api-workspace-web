import { apiClient } from '@/lib/api'
import type { TeamRole } from '@/lib/teams'

export interface TeamSummary {
  id: string
  name: string
  description: string
  memberCount: number
  createdAt: string
  updatedAt: string
  archivedAt: string | null
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

export interface TeamDetail extends TeamSummary {
  members: TeamMember[]
}

export interface AdminUser {
  id: string
  email: string
  firstName: string
  lastName: string
  avatarUrl?: string | null
  avatarColor: string
  systemRole: 'user' | 'admin'
  createdAt: string
  hasSignedIn: boolean
}

export interface AdminUserDetail extends AdminUser {
  teams: { id: string; name: string; role: TeamRole; archivedAt: string | null }[]
}

export interface AuditLogEntry {
  id: string
  actor: string | null
  action:
    | 'team.created'
    | 'team.updated'
    | 'team.archived'
    | 'team.unarchived'
    | 'team.deleted'
    | 'team.member_added'
    | 'team.member_role_changed'
    | 'team.member_removed'
    | 'user.system_role_changed'
    | 'user.deleted'
  targetType: 'team' | 'team_member' | 'user'
  targetId: string
  teamId: string | null
  details: Record<string, unknown>
  createdAt: string
}

export const adminApi = {
  async teams(includeArchived = false): Promise<TeamSummary[]> {
    const { data } = await apiClient.get<{ teams: TeamSummary[] }>('/admin/teams', {
      params: includeArchived ? { includeArchived: true } : undefined,
    })
    return data.teams
  },
  async createTeam(input: { name: string; description?: string }): Promise<TeamDetail> {
    const { data } = await apiClient.post<TeamDetail>('/admin/teams', input)
    return data
  },
  async team(teamId: string): Promise<TeamDetail> {
    const { data } = await apiClient.get<TeamDetail>(`/admin/teams/${teamId}`)
    return data
  },
  async updateTeam(teamId: string, input: { name?: string; description?: string }): Promise<TeamDetail> {
    const { data } = await apiClient.patch<TeamDetail>(`/admin/teams/${teamId}`, input)
    return data
  },
  async archiveTeam(teamId: string): Promise<TeamDetail> {
    const { data } = await apiClient.post<TeamDetail>(`/admin/teams/${teamId}/archive`)
    return data
  },
  async unarchiveTeam(teamId: string): Promise<TeamDetail> {
    const { data } = await apiClient.post<TeamDetail>(`/admin/teams/${teamId}/unarchive`)
    return data
  },
  async deleteTeam(teamId: string): Promise<void> {
    await apiClient.delete(`/admin/teams/${teamId}`)
  },
  async members(teamId: string): Promise<TeamMember[]> {
    const { data } = await apiClient.get<{ members: TeamMember[] }>(`/admin/teams/${teamId}/members`)
    return data.members
  },
  async addMember(teamId: string, input: { email: string; role?: TeamRole }): Promise<TeamMember> {
    const { data } = await apiClient.post<TeamMember>(`/admin/teams/${teamId}/members`, input)
    return data
  },
  async updateMember(teamId: string, userId: string, role: TeamRole): Promise<TeamMember> {
    const { data } = await apiClient.patch<TeamMember>(`/admin/teams/${teamId}/members/${userId}`, { role })
    return data
  },
  async removeMember(teamId: string, userId: string): Promise<void> {
    await apiClient.delete(`/admin/teams/${teamId}/members/${userId}`)
  },
  async users(input: { query: string; limit: number; offset: number }): Promise<{ users: AdminUser[]; total: number }> {
    const { data } = await apiClient.get<{ users: AdminUser[]; total: number }>('/admin/users', { params: input })
    return data
  },
  async user(userId: string): Promise<AdminUserDetail> {
    const { data } = await apiClient.get<AdminUserDetail>(`/admin/users/${userId}`)
    return data
  },
  async updateUser(userId: string, systemRole: 'user' | 'admin'): Promise<AdminUserDetail> {
    const { data } = await apiClient.patch<AdminUserDetail>(`/admin/users/${userId}`, { systemRole })
    return data
  },
  async deleteUser(userId: string): Promise<void> {
    await apiClient.delete(`/admin/users/${userId}`)
  },
  async auditLog(input: { teamId?: string; limit: number; offset: number }): Promise<{ entries: AuditLogEntry[]; total: number }> {
    const { data } = await apiClient.get<{ entries: AuditLogEntry[]; total: number }>('/admin/audit-log', { params: input })
    return data
  },
}
