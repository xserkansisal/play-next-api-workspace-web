import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import { UserAvatar } from '@/components/UserAvatar'
import { apiErrorCode, apiErrorDetails, describeApiError } from '@/lib/api'
import {
  adminApi,
  type AdminUser,
  type AdminUserDetail,
  type AuditLogEntry,
  type TeamDetail,
  type TeamSummary,
} from '@/lib/admin'
import type { TeamRole } from '@/lib/teams'

type Section = 'teams' | 'users' | 'audit'
type AdminErrorField = 'team-name' | 'member-email' | 'system-role' | 'user-delete'
interface PerformOptions {
  field?: AdminErrorField
  keepNotice?: boolean
  /** Background refreshes keep the error that triggered them visible. */
  keepError?: boolean
  /** Returns a friendlier message for codes specific to one action; falls back to the shared mapping. */
  describeError?: (code: string | undefined, cause: unknown) => string | undefined
}

const auditActionLabels: Record<AuditLogEntry['action'], string> = {
  'team.created': 'Team created',
  'team.updated': 'Team updated',
  'team.archived': 'Team archived',
  'team.unarchived': 'Team restored',
  'team.deleted': 'Team deleted',
  'team.member_added': 'Member added',
  'team.member_role_changed': 'Member role changed',
  'team.member_removed': 'Member removed',
  'user.system_role_changed': 'System role changed',
  'user.deleted': 'User deleted',
}
const pageSize = 50
const roles: TeamRole[] = ['owner', 'member', 'viewer']

interface AdminPanelProps {
  currentUserId?: string
  onClose: () => void
  onAdminRequired: () => void
}

export function AdminPanel({ currentUserId, onClose, onAdminRequired }: AdminPanelProps) {
  const [section, setSection] = useState<Section>('teams')
  const [teams, setTeams] = useState<TeamSummary[]>([])
  const [includeArchived, setIncludeArchived] = useState(false)
  const [selectedTeamId, setSelectedTeamId] = useState('')
  const selectedTeamIdRef = useRef(selectedTeamId)
  selectedTeamIdRef.current = selectedTeamId
  const [teamDetail, setTeamDetail] = useState<TeamDetail | null>(null)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [selectedUser, setSelectedUser] = useState<AdminUserDetail | null>(null)
  const [auditEntries, setAuditEntries] = useState<AuditLogEntry[]>([])
  const [auditTeamId, setAuditTeamId] = useState('')
  const [auditOffset, setAuditOffset] = useState(0)
  const [auditTotal, setAuditTotal] = useState(0)
  const [userQuery, setUserQuery] = useState('')
  const [submittedQuery, setSubmittedQuery] = useState('')
  const [userOffset, setUserOffset] = useState(0)
  const [userTotal, setUserTotal] = useState(0)
  const [teamName, setTeamName] = useState('')
  const [teamDescription, setTeamDescription] = useState('')
  const [newTeamName, setNewTeamName] = useState('')
  const [newTeamDescription, setNewTeamDescription] = useState('')
  const [memberEmail, setMemberEmail] = useState('')
  const [memberRole, setMemberRole] = useState<TeamRole>('member')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState<{ field: AdminErrorField; message: string } | null>(null)
  const [missingTargetCode, setMissingTargetCode] = useState<string | null>(null)
  const [deleteBlocker, setDeleteBlocker] = useState<{ teamId: string; teamName: string; archived: boolean } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const teamOwnerCount = teamDetail?.members.filter(({ role }) => role === 'owner').length ?? 0

  const perform = useCallback(async <T,>(action: () => Promise<T>, options: PerformOptions = {}): Promise<T | null> => {
    setBusy(true)
    if (!options.keepError) {
      setError(null)
      setFieldError(null)
    }
    if (!options.keepNotice) setNotice(null)
    try {
      return await action()
    } catch (cause) {
      const code = apiErrorCode(cause)
      if (code === 'ADMIN_REQUIRED') onAdminRequired()
      else {
        if (code === 'TEAM_NOT_FOUND' || code === 'TEAM_MEMBER_NOT_FOUND' || code === 'USER_NOT_FOUND') {
          setMissingTargetCode(code)
        }
        const message = options.describeError?.(code, cause) ?? (code === 'LAST_SYSTEM_ADMIN'
          ? 'At least one system admin must remain. The last system admin cannot remove their own admin role.'
          : describeApiError(cause))
        const field = options.field ?? (code === 'TEAM_NAME_CONFLICT'
          ? 'team-name'
          : code === 'EMAIL_DOMAIN_NOT_ALLOWED' || code === 'TEAM_MEMBER_EXISTS'
            ? 'member-email'
            : code === 'LAST_SYSTEM_ADMIN'
              ? 'system-role'
              : null)
        setError(message)
        if (field) setFieldError({ field, message })
      }
      return null
    } finally {
      setBusy(false)
    }
  }, [onAdminRequired])

  const refreshTeams = useCallback(async () => {
    const nextTeams = await perform(() => adminApi.teams(includeArchived))
    if (!nextTeams) return
    setTeams(nextTeams)
    if (!nextTeams.some(({ id }) => id === selectedTeamIdRef.current)) {
      setSelectedTeamId(nextTeams[0]?.id ?? '')
      setTeamDetail(null)
    }
  }, [includeArchived, perform])

  const refreshTeam = useCallback(async (teamId: string) => {
    const detail = await perform(() => adminApi.team(teamId))
    if (!detail) return
    setTeamDetail(detail)
    setTeamName(detail.name)
    setTeamDescription(detail.description)
  }, [perform])

  useEffect(() => { void refreshTeams() }, [refreshTeams])

  useEffect(() => {
    if (section === 'teams' && selectedTeamId) void refreshTeam(selectedTeamId)
  }, [refreshTeam, section, selectedTeamId])

  const loadUsers = useCallback(async (query: string, offset: number, keepError = false) => {
    const result = await perform(() => adminApi.users({ query, limit: pageSize, offset }), { keepNotice: true, keepError })
    if (!result) return
    setUsers(result.users)
    setUserTotal(result.total)
  }, [perform])

  useEffect(() => {
    if (section === 'users') void loadUsers(submittedQuery, userOffset)
  }, [loadUsers, section, submittedQuery, userOffset])

  const loadAudit = useCallback(async (teamId: string, offset: number) => {
    const result = await perform(() => adminApi.auditLog({
      ...(teamId ? { teamId } : {}),
      limit: pageSize,
      offset,
    }))
    if (!result) return
    setAuditEntries(result.entries)
    setAuditTotal(result.total)
  }, [perform])

  useEffect(() => {
    if (section === 'audit') void loadAudit(auditTeamId, auditOffset)
  }, [auditOffset, auditTeamId, loadAudit, section])

  useEffect(() => {
    if (!missingTargetCode) return
    const code = missingTargetCode
    setMissingTargetCode(null)
    if (code === 'TEAM_NOT_FOUND' || code === 'TEAM_MEMBER_NOT_FOUND') {
      void refreshTeams()
      if (code === 'TEAM_MEMBER_NOT_FOUND' && selectedTeamId) void refreshTeam(selectedTeamId)
    } else if (section === 'users') {
      void loadUsers(submittedQuery, userOffset, true)
    }
  }, [loadUsers, missingTargetCode, refreshTeam, refreshTeams, section, selectedTeamId, submittedQuery, userOffset])

  async function createTeam(event: FormEvent) {
    event.preventDefault()
    const created = await perform(() => adminApi.createTeam({
      name: newTeamName.trim(),
      ...(newTeamDescription.trim() ? { description: newTeamDescription.trim() } : {}),
    }))
    if (!created) return
    setNewTeamName('')
    setNewTeamDescription('')
    setSelectedTeamId(created.id)
    setTeamDetail(created)
    setTeamName(created.name)
    setTeamDescription(created.description)
    setNotice('Team created.')
    await refreshTeams()
  }

  async function saveTeam(event: FormEvent) {
    event.preventDefault()
    if (!teamDetail) return
    const updated = await perform(() => adminApi.updateTeam(teamDetail.id, {
      name: teamName.trim(),
      description: teamDescription,
    }))
    if (updated) {
      setTeamDetail(updated)
      setNotice('Team details saved.')
      await refreshTeams()
    }
  }

  async function addMember(event: FormEvent) {
    event.preventDefault()
    if (!teamDetail) return
    const added = await perform(() => adminApi.addMember(teamDetail.id, {
      email: memberEmail.trim(),
      role: memberRole,
    }))
    if (!added) return
    setMemberEmail('')
    setNotice('Member added.')
    await refreshTeam(teamDetail.id)
    await refreshTeams()
  }

  async function changeMemberRole(userId: string, role: TeamRole) {
    if (!teamDetail) return
    const member = teamDetail.members.find(({ userId: memberId }) => memberId === userId)
    const ownerCount = teamDetail.members.filter(({ role: currentRole }) => currentRole === 'owner').length
    if (member?.role === 'owner' && role !== 'owner' && ownerCount === 1) {
      setError('The last team owner cannot be demoted. Add another owner first.')
      return
    }
    const updated = await perform(() => adminApi.updateMember(teamDetail.id, userId, role))
    if (updated) await refreshTeam(teamDetail.id)
  }

  async function removeMember(userId: string) {
    if (!teamDetail) return
    const member = teamDetail.members.find(({ userId: memberId }) => memberId === userId)
    const ownerCount = teamDetail.members.filter(({ role: currentRole }) => currentRole === 'owner').length
    if (member?.role === 'owner' && ownerCount === 1) {
      setError('The last team owner cannot be removed. Add another owner first.')
      return
    }
    if (!window.confirm('Remove this member from the team?')) return
    const removed = await perform(() => adminApi.removeMember(teamDetail.id, userId))
    if (removed !== null) {
      setNotice('Member removed.')
      await refreshTeam(teamDetail.id)
      await refreshTeams()
    }
  }

  async function changeTeamArchiveState() {
    if (!teamDetail) return
    const action = teamDetail.archivedAt ? 'unarchive' : 'archive'
    if (!window.confirm(`${action === 'archive' ? 'Archive' : 'Unarchive'} ${teamDetail.name}?`)) return
    const updated = await perform(() => action === 'archive'
      ? adminApi.archiveTeam(teamDetail.id)
      : adminApi.unarchiveTeam(teamDetail.id))
    if (updated) {
      setTeamDetail(updated)
      setNotice(action === 'archive' ? 'Team archived.' : 'Team restored.')
      await refreshTeams()
    }
  }

  async function deleteTeam() {
    if (!teamDetail || !teamDetail.archivedAt || !window.confirm(`Permanently delete ${teamDetail.name}?`)) return
    const deleted = await perform(() => adminApi.deleteTeam(teamDetail.id))
    if (deleted !== null) {
      setSelectedTeamId('')
      setTeamDetail(null)
      setNotice('Team deleted.')
      await refreshTeams()
    }
  }

  async function openUser(user: AdminUser) {
    setDeleteBlocker(null)
    const detail = await perform(() => adminApi.user(user.id))
    if (detail) setSelectedUser(detail)
  }

  async function changeSystemRole(systemRole: 'user' | 'admin') {
    if (!selectedUser) return
    const updated = await perform(() => adminApi.updateUser(selectedUser.id, systemRole))
    if (updated) {
      setSelectedUser(updated)
      setUsers((current) => current.map((user) => user.id === updated.id ? updated : user))
      setNotice('System role updated.')
      if (updated.id === currentUserId && systemRole === 'user') onAdminRequired()
    }
  }

  async function deleteUser() {
    if (!selectedUser || selectedUser.id === currentUserId) return
    const user = selectedUser
    const label = [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email
    const confirmed = window.confirm(
      `Permanently delete ${label} (${user.email})?\n\n`
      + 'Their sessions, team memberships, run history, personal variables, preferences and avatar will be removed. '
      + 'Shared content they authored will remain but show "Unknown user". This cannot be undone.',
    )
    if (!confirmed) return
    setDeleteBlocker(null)
    const deleted = await perform(async () => {
      await adminApi.deleteUser(user.id)
      return true
    }, {
      field: 'user-delete',
      describeError: (code, cause) => {
        if (code === 'CANNOT_DELETE_SELF') return 'You cannot delete your own account. Ask another system admin to do it.'
        if (code === 'LAST_SYSTEM_ADMIN') return `${label} is the only system admin. Promote another admin first.`
        if (code === 'USER_NOT_FOUND') {
          setSelectedUser(null)
          return 'This user no longer exists. The user list was refreshed.'
        }
        if (code === 'TEAM_LAST_OWNER') {
          const teamId = apiErrorDetails(cause)?.teamId
          const team = typeof teamId === 'string'
            ? user.teams.find(({ id }) => id === teamId) ?? teams.find(({ id }) => id === teamId)
            : undefined
          if (team) setDeleteBlocker({ teamId: team.id, teamName: team.name, archived: !!team.archivedAt })
          const teamLabel = team?.name ?? 'one of their teams'
          return `${label} is the only owner of ${teamLabel}. Assign another owner to ${teamLabel} first.`
        }
        return undefined
      },
    })
    if (!deleted) return
    setSelectedUser(null)
    setUsers((current) => current.filter(({ id }) => id !== user.id))
    const nextOffset = users.length === 1 && userOffset > 0 ? Math.max(0, userOffset - pageSize) : userOffset
    if (nextOffset !== userOffset) setUserOffset(nextOffset)
    else await loadUsers(submittedQuery, userOffset)
    await refreshTeams()
    if (selectedTeamIdRef.current && user.teams.some(({ id }) => id === selectedTeamIdRef.current)) {
      await refreshTeam(selectedTeamIdRef.current)
    }
    setNotice(`${label} was deleted.`)
  }

  function openBlockingTeam() {
    if (!deleteBlocker) return
    if (deleteBlocker.archived) setIncludeArchived(true)
    setSelectedTeamId(deleteBlocker.teamId)
    setSection('teams')
    setError(null)
    setNotice(null)
    setDeleteBlocker(null)
  }

  function submitUserSearch(event: FormEvent) {
    event.preventDefault()
    setUserOffset(0)
    setSubmittedQuery(userQuery.trim())
    setSelectedUser(null)
  }

  function changeAuditTeam(teamId: string) {
    setAuditTeamId(teamId)
    setAuditOffset(0)
  }

  return (
    <section className="admin-panel" aria-labelledby="admin-title">
      <header className="admin-heading">
        <div>
          <span className="admin-eyebrow">SYSTEM ADMINISTRATION</span>
          <h1 id="admin-title">Admin panel</h1>
          <p>Manage teams, memberships, user access and administrative activity.</p>
        </div>
        <Button variant="outline" onClick={onClose}>Back to workspace</Button>
      </header>
      <nav className="admin-nav" aria-label="Admin sections">
        {(['teams', 'users', 'audit'] as const).map((item) => (
          <button key={item} type="button" aria-current={section === item ? 'page' : undefined} onClick={() => { setSection(item); setError(null); setNotice(null) }}>
            {item === 'audit' ? 'Audit log' : item[0]!.toUpperCase() + item.slice(1)}
          </button>
        ))}
      </nav>
      {error && <p className="admin-alert" role="alert">{error}</p>}
      {notice && <p className="admin-notice" role="status">{notice}</p>}

      {section === 'teams' && (
        <div className="admin-columns">
          <div className="admin-card admin-team-list">
            <div className="admin-card-heading">
              <div><h2>Teams</h2><p>{teams.length} {teams.length === 1 ? 'team' : 'teams'}</p></div>
              <label className="admin-checkbox"><input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} /> Show archived</label>
            </div>
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>Name</th><th>Members</th><th>Status</th></tr></thead>
                <tbody>
                  {teams.map((team) => (
                    <tr key={team.id} className={selectedTeamId === team.id ? 'selected' : ''}>
                      <td><button type="button" className="admin-link" onClick={() => setSelectedTeamId(team.id)}>{team.name}</button><small>{team.description || 'No description'}</small></td>
                      <td>{team.memberCount}</td>
                      <td>{team.archivedAt ? <span className="admin-badge">Archived</span> : 'Active'}</td>
                    </tr>
                  ))}
                  {teams.length === 0 && <tr><td colSpan={3} className="admin-empty-cell">No teams to show.</td></tr>}
                </tbody>
              </table>
            </div>
            <form className="admin-form admin-create-team" onSubmit={(event) => void createTeam(event)}>
              <h3>Create team</h3>
              <label>Team name<input required maxLength={100} aria-invalid={fieldError?.field === 'team-name' || undefined} value={newTeamName} onChange={(event) => { setNewTeamName(event.target.value); setFieldError(null) }} />{fieldError?.field === 'team-name' && <small className="admin-field-error" role="alert">{fieldError.message}</small>}</label>
              <label>Description<input maxLength={500} value={newTeamDescription} onChange={(event) => setNewTeamDescription(event.target.value)} /></label>
              <Button disabled={busy || !newTeamName.trim()}>Create team</Button>
            </form>
          </div>

          <div className="admin-card admin-team-detail">
            {teamDetail ? (
              <>
                <div className="admin-card-heading">
                  <div><h2>Team details</h2><p>{teamDetail.archivedAt ? 'Archived team' : 'Active team'}</p></div>
                </div>
                <form className="admin-form" onSubmit={(event) => void saveTeam(event)}>
                  <label>Name<input required maxLength={100} aria-invalid={fieldError?.field === 'team-name' || undefined} value={teamName} onChange={(event) => { setTeamName(event.target.value); setFieldError(null) }} />{fieldError?.field === 'team-name' && <small className="admin-field-error" role="alert">{fieldError.message}</small>}</label>
                  <label>Description<textarea maxLength={500} rows={2} value={teamDescription} onChange={(event) => setTeamDescription(event.target.value)} /></label>
                  <Button disabled={busy || !teamName.trim()}>Save team</Button>
                </form>
                <div className="admin-members">
                  <h3>Members <span>{teamDetail.members.length}</span></h3>
                  {teamOwnerCount === 1 && <p className="admin-invariant-note">The last team owner cannot be demoted or removed. Add another owner first.</p>}
                  <div className="admin-table-wrap">
                    <table className="admin-table">
                      <thead><tr><th>Member</th><th>Role</th><th>Joined</th><th /></tr></thead>
                      <tbody>
                        {teamDetail.members.map((member) => (
                          <tr key={member.userId}>
                            <td>
                              <div className="admin-user-cell">
                                <UserAvatar {...member} className="admin-user-avatar" />
                                <div>
                                  <strong>{[member.firstName, member.lastName].filter(Boolean).join(' ') || member.email}</strong>
                                  <small>{member.email}</small>
                                </div>
                              </div>
                            </td>
                            <td><select aria-label={`Role for ${member.email}`} disabled={busy || !!teamDetail.archivedAt} value={member.role} onChange={(event) => void changeMemberRole(member.userId, event.target.value as TeamRole)}>{roles.map((role) => <option key={role} value={role} disabled={member.role === 'owner' && role !== 'owner' && teamOwnerCount === 1}>{role[0]!.toUpperCase() + role.slice(1)}</option>)}</select></td>
                            <td>{new Date(member.joinedAt).toLocaleDateString()}</td>
                            <td><button className="admin-danger-link" type="button" disabled={busy || !!teamDetail.archivedAt || (member.role === 'owner' && teamOwnerCount === 1)} title={member.role === 'owner' && teamOwnerCount === 1 ? 'Add another owner before removing this member.' : undefined} onClick={() => void removeMember(member.userId)}>Remove</button></td>
                          </tr>
                        ))}
                        {teamDetail.members.length === 0 && <tr><td colSpan={4} className="admin-empty-cell">No members yet.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                  <form className="admin-form admin-add-member" onSubmit={(event) => void addMember(event)}>
                    <h4>Add member</h4>
                    <label>Email<input required type="email" aria-invalid={fieldError?.field === 'member-email' || undefined} value={memberEmail} disabled={busy || !!teamDetail.archivedAt} onChange={(event) => { setMemberEmail(event.target.value); setFieldError(null) }} />{fieldError?.field === 'member-email' && <small className="admin-field-error" role="alert">{fieldError.message}</small>}</label>
                    <label>Role<select value={memberRole} disabled={busy || !!teamDetail.archivedAt} onChange={(event) => setMemberRole(event.target.value as TeamRole)}>{roles.map((role) => <option key={role} value={role}>{role[0]!.toUpperCase() + role.slice(1)}</option>)}</select></label>
                    <Button disabled={busy || !!teamDetail.archivedAt || !memberEmail.trim()}>Add member</Button>
                  </form>
                </div>
                <div className="admin-actions">
                  <Button variant="outline" disabled={busy} onClick={() => void changeTeamArchiveState()}>{teamDetail.archivedAt ? 'Unarchive team' : 'Archive team'}</Button>
                  {teamDetail.archivedAt && <Button variant="destructive" disabled={busy} onClick={() => void deleteTeam()}>Delete team</Button>}
                </div>
              </>
            ) : <div className="admin-empty-state"><h2>Select a team</h2><p>Choose a team to manage its details and members.</p></div>}
          </div>
        </div>
      )}

      {section === 'users' && (
        <div className="admin-card admin-users-card">
          <div className="admin-card-heading">
            <div><h2>Users</h2><p aria-live="polite">{userTotal} {userTotal === 1 ? 'matching account' : 'matching accounts'}</p></div>
            <form className="admin-search" onSubmit={submitUserSearch}>
              <label htmlFor="admin-user-search">Search users</label>
              <input id="admin-user-search" type="search" placeholder="Name or email" value={userQuery} onChange={(event) => setUserQuery(event.target.value)} />
              <Button variant="outline" disabled={busy}>Search</Button>
            </form>
          </div>
          <div className={`admin-users-layout${selectedUser ? ' has-selection' : ''}`}>
            <div className="admin-table-wrap">
              <table className="admin-table admin-users-table" aria-label="User accounts">
                <thead><tr><th scope="col">User</th><th scope="col">System role</th><th scope="col">Account</th></tr></thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id} className={selectedUser?.id === user.id ? 'selected' : ''}>
                      <td>
                        <div className="admin-user-cell">
                          <UserAvatar {...user} className="admin-user-avatar" />
                          <div>
                            <button type="button" className="admin-link" aria-label={`Manage ${[user.firstName, user.lastName].filter(Boolean).join(' ') || user.email}`} onClick={() => void openUser(user)}>{[user.firstName, user.lastName].filter(Boolean).join(' ') || user.email}</button>
                            <small>{user.email}</small>
                          </div>
                        </div>
                      </td>
                      <td><span className={`admin-role-badge${user.systemRole === 'admin' ? ' is-admin' : ''}`}>{user.systemRole === 'admin' ? 'Admin' : 'User'}</span></td>
                      <td>{user.hasSignedIn
                        ? <span className="admin-account-status is-active"><span aria-hidden="true" />Active</span>
                        : <span className="admin-account-status is-pending"><span aria-hidden="true" />Not signed in</span>}</td>
                    </tr>
                  ))}
                  {users.length === 0 && <tr><td colSpan={3} className="admin-empty-cell">
                    <strong>{submittedQuery ? 'No matching users' : 'No users yet'}</strong>
                    <span>{submittedQuery ? 'Try a different name or email address.' : 'User accounts will appear here.'}</span>
                  </td></tr>}
                </tbody>
              </table>
              <div className="admin-pagination">
                <span>Showing {userTotal === 0 ? 0 : userOffset + 1}–{Math.min(userOffset + users.length, userTotal)} of {userTotal}</span>
                <div>
                  <Button variant="outline" size="sm" disabled={busy || userOffset === 0} onClick={() => setUserOffset((offset) => Math.max(0, offset - pageSize))}>Previous</Button>
                  <Button variant="outline" size="sm" disabled={busy || userOffset + pageSize >= userTotal} onClick={() => setUserOffset((offset) => offset + pageSize)}>Next</Button>
                </div>
              </div>
            </div>
            {selectedUser && (
              <aside className="admin-user-detail">
                <div className="admin-user-profile">
                  <UserAvatar {...selectedUser} className="admin-user-avatar admin-user-detail-avatar" />
                  <div>
                    <h3>{[selectedUser.firstName, selectedUser.lastName].filter(Boolean).join(' ') || selectedUser.email}</h3>
                    <p>{selectedUser.email}</p>
                  </div>
                </div>
                <div className="admin-system-role-field">
                  <label htmlFor="admin-system-role">System role</label>
                  <select id="admin-system-role" disabled={busy} aria-invalid={fieldError?.field === 'system-role' || undefined} value={selectedUser.systemRole} onChange={(event) => void changeSystemRole(event.target.value as 'user' | 'admin')}><option value="user">User</option><option value="admin">Admin</option></select>
                  {fieldError?.field === 'system-role' && <small className="admin-field-error" role="alert">{fieldError.message}</small>}
                  {selectedUser.id === currentUserId && selectedUser.systemRole === 'admin' && <small className="admin-role-hint">If you are the last system admin, you cannot remove your own admin role.</small>}
                </div>
                {!selectedUser.hasSignedIn && <span className="admin-badge">Not signed in yet</span>}
                <h4>Teams</h4>
                {selectedUser.teams.length ? <ul>{selectedUser.teams.map((team) => <li key={team.id}>{team.name} · {team.role}{team.archivedAt ? ' · archived' : ''}</li>)}</ul> : <p>Not a member of any team.</p>}
                <section className="admin-danger-zone" aria-labelledby="admin-delete-user-heading">
                  <h4 id="admin-delete-user-heading">Delete user</h4>
                  <p>Permanently removes sessions, team memberships, run history, personal variables, preferences and avatar. Shared content they authored will show as “Unknown user”.</p>
                  {selectedUser.id !== currentUserId && selectedUser.teams.some((team) => team.role === 'owner') && (
                    <small className="admin-role-hint">Owns {selectedUser.teams.filter((team) => team.role === 'owner').map((team) => team.name).join(', ')}. If they are the last owner of any of these teams, assign another owner first.</small>
                  )}
                  {selectedUser.id === currentUserId && <small className="admin-role-hint">You cannot delete your own account.</small>}
                  <Button variant="destructive" size="sm" disabled={busy || selectedUser.id === currentUserId} aria-invalid={fieldError?.field === 'user-delete' || undefined} onClick={() => void deleteUser()}>Delete user</Button>
                  {fieldError?.field === 'user-delete' && <small className="admin-field-error" role="alert">{fieldError.message}</small>}
                  {deleteBlocker && <Button variant="outline" size="sm" onClick={openBlockingTeam}>Open {deleteBlocker.teamName}</Button>}
                </section>
              </aside>
            )}
          </div>
        </div>
      )}

      {section === 'audit' && (
        <div className="admin-card admin-audit-card">
          <div className="admin-card-heading">
            <div><h2>Audit log</h2><p>{auditTotal} entries</p></div>
            <label className="admin-filter">Filter by team<select value={auditTeamId} onChange={(event) => changeAuditTeam(event.target.value)}><option value="">All teams</option>{teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}</select></label>
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th><th>Details</th></tr></thead>
              <tbody>
                {auditEntries.map((entry) => (
                  <tr key={entry.id}>
                    <td>{new Date(entry.createdAt).toLocaleString()}</td>
                    <td>{entry.actor ?? 'System'}</td>
                    <td><span className="admin-audit-action">{auditActionLabels[entry.action] ?? entry.action}<code>{entry.action}</code></span></td>
                    <td>{entry.targetType}{entry.teamId ? <small>{teams.find(({ id }) => id === entry.teamId)?.name ?? entry.teamId}</small> : null}</td>
                    <td>{Object.keys(entry.details).length ? JSON.stringify(entry.details) : '—'}</td>
                  </tr>
                ))}
                {auditEntries.length === 0 && <tr><td colSpan={5} className="admin-empty-cell">No audit entries found.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="admin-pagination">
            <span>{auditTotal === 0 ? 0 : auditOffset + 1}–{Math.min(auditOffset + auditEntries.length, auditTotal)} of {auditTotal}</span>
            <Button variant="outline" size="sm" disabled={busy || auditOffset === 0} onClick={() => setAuditOffset((offset) => Math.max(0, offset - pageSize))}>Previous</Button>
            <Button variant="outline" size="sm" disabled={busy || auditOffset + pageSize >= auditTotal} onClick={() => setAuditOffset((offset) => offset + pageSize)}>Next</Button>
          </div>
        </div>
      )}
    </section>
  )
}
