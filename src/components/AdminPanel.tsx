import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import { apiErrorCode, describeApiError } from '@/lib/api'
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
const pageSize = 50
const roles: TeamRole[] = ['owner', 'admin', 'member']

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
  const [fieldError, setFieldError] = useState<{ field: 'team-name' | 'member-email' | 'system-role'; message: string } | null>(null)
  const [missingTargetCode, setMissingTargetCode] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const perform = useCallback(async <T,>(action: () => Promise<T>): Promise<T | null> => {
    setBusy(true)
    setError(null)
    setFieldError(null)
    setNotice(null)
    try {
      return await action()
    } catch (cause) {
      const code = apiErrorCode(cause)
      if (code === 'ADMIN_REQUIRED') onAdminRequired()
      else {
        if (code === 'TEAM_NOT_FOUND' || code === 'TEAM_MEMBER_NOT_FOUND' || code === 'USER_NOT_FOUND') {
          setMissingTargetCode(code)
        }
        const message = describeApiError(cause)
        const field = code === 'TEAM_NAME_CONFLICT'
          ? 'team-name'
          : code === 'EMAIL_DOMAIN_NOT_ALLOWED' || code === 'TEAM_MEMBER_EXISTS'
            ? 'member-email'
            : code === 'LAST_SYSTEM_ADMIN'
              ? 'system-role'
              : null
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

  const loadUsers = useCallback(async (query: string, offset: number) => {
    const result = await perform(() => adminApi.users({ query, limit: pageSize, offset }))
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
      void loadUsers(submittedQuery, userOffset)
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
    const updated = await perform(() => adminApi.updateMember(teamDetail.id, userId, role))
    if (updated) await refreshTeam(teamDetail.id)
  }

  async function removeMember(userId: string) {
    if (!teamDetail || !window.confirm('Remove this member from the team?')) return
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
                  <div className="admin-table-wrap">
                    <table className="admin-table">
                      <thead><tr><th>Member</th><th>Role</th><th>Joined</th><th /></tr></thead>
                      <tbody>
                        {teamDetail.members.map((member) => (
                          <tr key={member.userId}>
                            <td><strong>{[member.firstName, member.lastName].filter(Boolean).join(' ') || member.email}</strong><small>{member.email}</small></td>
                            <td><select aria-label={`Role for ${member.email}`} disabled={busy || !!teamDetail.archivedAt} value={member.role} onChange={(event) => void changeMemberRole(member.userId, event.target.value as TeamRole)}>{roles.map((role) => <option key={role}>{role}</option>)}</select></td>
                            <td>{new Date(member.joinedAt).toLocaleDateString()}</td>
                            <td><button className="admin-danger-link" type="button" disabled={busy || !!teamDetail.archivedAt} onClick={() => void removeMember(member.userId)}>Remove</button></td>
                          </tr>
                        ))}
                        {teamDetail.members.length === 0 && <tr><td colSpan={4} className="admin-empty-cell">No members yet.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                  <form className="admin-form admin-add-member" onSubmit={(event) => void addMember(event)}>
                    <h4>Add member</h4>
                    <label>Email<input required type="email" aria-invalid={fieldError?.field === 'member-email' || undefined} value={memberEmail} disabled={busy || !!teamDetail.archivedAt} onChange={(event) => { setMemberEmail(event.target.value); setFieldError(null) }} />{fieldError?.field === 'member-email' && <small className="admin-field-error" role="alert">{fieldError.message}</small>}</label>
                    <label>Role<select value={memberRole} disabled={busy || !!teamDetail.archivedAt} onChange={(event) => setMemberRole(event.target.value as TeamRole)}>{roles.map((role) => <option key={role}>{role}</option>)}</select></label>
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
        <div className="admin-card">
          <div className="admin-card-heading">
            <div><h2>Users</h2><p>{userTotal} matching accounts</p></div>
            <form className="admin-search" onSubmit={submitUserSearch}>
              <label htmlFor="admin-user-search">Search users</label>
              <input id="admin-user-search" type="search" placeholder="Name or email" value={userQuery} onChange={(event) => setUserQuery(event.target.value)} />
              <Button variant="outline">Search</Button>
            </form>
          </div>
          <div className="admin-users-layout">
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>User</th><th>System role</th><th>Account</th></tr></thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id} className={selectedUser?.id === user.id ? 'selected' : ''}>
                      <td><button type="button" className="admin-link" onClick={() => void openUser(user)}>{[user.firstName, user.lastName].filter(Boolean).join(' ') || user.email}</button><small>{user.email}</small></td>
                      <td>{user.systemRole}</td>
                      <td>{user.hasSignedIn ? 'Active' : <span className="admin-badge">Not signed in yet</span>}</td>
                    </tr>
                  ))}
                  {users.length === 0 && <tr><td colSpan={3} className="admin-empty-cell">No users found.</td></tr>}
                </tbody>
              </table>
              <div className="admin-pagination">
                <span>{userTotal === 0 ? 0 : userOffset + 1}–{Math.min(userOffset + users.length, userTotal)} of {userTotal}</span>
                <Button variant="outline" size="sm" disabled={busy || userOffset === 0} onClick={() => setUserOffset((offset) => Math.max(0, offset - pageSize))}>Previous</Button>
                <Button variant="outline" size="sm" disabled={busy || userOffset + pageSize >= userTotal} onClick={() => setUserOffset((offset) => offset + pageSize)}>Next</Button>
              </div>
            </div>
            {selectedUser && (
              <aside className="admin-user-detail">
                <h3>{[selectedUser.firstName, selectedUser.lastName].filter(Boolean).join(' ') || selectedUser.email}</h3>
                <p>{selectedUser.email}</p>
                <label>System role<select disabled={busy} aria-invalid={fieldError?.field === 'system-role' || undefined} value={selectedUser.systemRole} onChange={(event) => void changeSystemRole(event.target.value as 'user' | 'admin')}><option value="user">User</option><option value="admin">Admin</option></select>{fieldError?.field === 'system-role' && <small className="admin-field-error" role="alert">{fieldError.message}</small>}</label>
                {!selectedUser.hasSignedIn && <span className="admin-badge">Not signed in yet</span>}
                <h4>Teams</h4>
                {selectedUser.teams.length ? <ul>{selectedUser.teams.map((team) => <li key={team.id}>{team.name} · {team.role}{team.archivedAt ? ' · archived' : ''}</li>)}</ul> : <p>Not a member of any team.</p>}
              </aside>
            )}
          </div>
        </div>
      )}

      {section === 'audit' && (
        <div className="admin-card">
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
                    <td><code>{entry.action}</code></td>
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
