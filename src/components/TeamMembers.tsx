import { useCallback, useEffect, useState, type FormEvent } from 'react'

import { UserAvatar } from '@/components/UserAvatar'
import { Button } from '@/components/ui/button'
import { describeApiError, workspaceApi } from '@/lib/api'
import type { TeamMember, TeamRole } from '@/lib/teams'

const roles: TeamRole[] = ['owner', 'member', 'viewer']

export function TeamMembers({ teamId, teamName, onChanged }: {
  teamId: string
  teamName: string
  onChanged: () => Promise<void>
}) {
  const [members, setMembers] = useState<TeamMember[]>([])
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<TeamRole>('member')
  const [loading, setLoading] = useState(true)
  const [busyUserId, setBusyUserId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ownerCount = members.filter(({ role: currentRole }) => currentRole === 'owner').length

  const reload = useCallback(async () => {
    setError(null)
    try {
      setMembers(await workspaceApi.teamMembers(teamId))
    } catch (cause) {
      setError(describeApiError(cause))
    } finally {
      setLoading(false)
    }
  }, [teamId])

  useEffect(() => { void reload() }, [reload])

  async function addMember(event: FormEvent) {
    event.preventDefault()
    const normalizedEmail = email.trim()
    if (!normalizedEmail) return
    setBusy(true)
    setError(null)
    try {
      await workspaceApi.addTeamMember(teamId, { email: normalizedEmail, role })
      setEmail('')
      await reload()
      await onChanged()
    } catch (cause) {
      setError(describeApiError(cause))
    } finally {
      setBusy(false)
    }
  }

  async function changeRole(member: TeamMember, nextRole: TeamRole) {
    if (member.role === 'owner' && nextRole !== 'owner' && ownerCount === 1) {
      setError('The last team owner cannot be demoted. Add another owner first.')
      return
    }
    setBusyUserId(member.userId)
    setError(null)
    try {
      await workspaceApi.updateTeamMember(teamId, member.userId, nextRole)
      await reload()
      await onChanged()
    } catch (cause) {
      setError(describeApiError(cause))
    } finally {
      setBusyUserId(null)
    }
  }

  async function removeMember(member: TeamMember) {
    if (member.role === 'owner' && ownerCount === 1) {
      setError('The last team owner cannot be removed. Add another owner first.')
      return
    }
    setBusyUserId(member.userId)
    setError(null)
    try {
      await workspaceApi.removeTeamMember(teamId, member.userId)
      await reload()
      await onChanged()
    } catch (cause) {
      setError(describeApiError(cause))
    } finally {
      setBusyUserId(null)
    }
  }

  return (
    <section className="team-members-panel" aria-labelledby="team-members-title">
      <header>
        <div>
          <h1 id="team-members-title">Members</h1>
          <p>Manage access to {teamName}.</p>
        </div>
        {!loading && !error && (
          <span className="team-members-count" aria-live="polite">
            {members.length} {members.length === 1 ? 'member' : 'members'}
          </span>
        )}
      </header>
      <form className="team-member-add" onSubmit={(event) => void addMember(event)}>
        <label className="field-label">
          Email
          <input
            className="text-field"
            type="email"
            autoComplete="email"
            placeholder="name@example.com"
            required
            value={email}
            disabled={busy}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label className="field-label">
          Role
          <select className="text-field" value={role} disabled={busy} onChange={(event) => setRole(event.target.value as TeamRole)}>
            {roles.map((option) => <option key={option} value={option}>{option[0]!.toUpperCase() + option.slice(1)}</option>)}
          </select>
        </label>
        <Button type="submit" disabled={busy || !email.trim()}>{busy ? 'Saving…' : 'Add member'}</Button>
      </form>
      {error && <p className="inline-error" role="alert">{error}</p>}
      {loading ? <p role="status">Loading members…</p> : error ? null : members.length === 0 ? (
        <p>No members in this team.</p>
      ) : (
        <div className="team-members-table-wrap">
          {ownerCount === 1 && (
            <p className="team-owner-note">The last team owner cannot be demoted or removed. Add another owner first.</p>
          )}
          <table className="team-members-table">
            <thead><tr><th>Member</th><th>Role</th><th>Joined</th><th><span className="sr-only">Actions</span></th></tr></thead>
            <tbody>
              {members.map((member) => (
                <tr key={member.userId}>
                  <td>
                    <div className="team-member-identity">
                      <UserAvatar {...member} className="admin-user-avatar" />
                      <div className="team-member-copy">
                        <strong>{[member.firstName, member.lastName].filter(Boolean).join(' ') || member.email}</strong>
                        {member.firstName || member.lastName ? <span>{member.email}</span> : null}
                      </div>
                    </div>
                  </td>
                  <td>
                    <select aria-label={`Role for ${member.email}`} value={member.role} disabled={busy || busyUserId !== null} onChange={(event) => void changeRole(member, event.target.value as TeamRole)}>
                      {roles.map((option) => <option key={option} value={option} disabled={member.role === 'owner' && option !== 'owner' && ownerCount === 1}>{option[0]!.toUpperCase() + option.slice(1)}</option>)}
                    </select>
                  </td>
                  <td><time dateTime={member.joinedAt}>{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(member.joinedAt))}</time></td>
                  <td>
                    <button
                      type="button"
                      className="admin-danger-link"
                      aria-label={`Remove ${member.email}`}
                      disabled={busy || busyUserId !== null || (member.role === 'owner' && ownerCount === 1)}
                      title={member.role === 'owner' && ownerCount === 1 ? 'Add another owner before removing this member.' : undefined}
                      onClick={() => void removeMember(member)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
