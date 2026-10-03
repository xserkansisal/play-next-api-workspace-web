import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'

import App from '@/App'
import { SignIn } from '@/components/SignIn'
import { authApi, onUnauthenticated, teamsApi } from '@/lib/auth'
import type { AuthUser } from '@/lib/auth'
import { describeApiError } from '@/lib/api'
import { chooseActiveTeam, saveActiveTeamId, setActiveTeamId, teamContextEvents } from '@/lib/teams'
import type { TeamContextErrorCode } from '@/lib/teams'
import type { Team } from '@/lib/teams'
import { resetScopedVariables } from '@/lib/scoped-variables'

const AdminPanel = lazy(async () => {
  const module = await import('@/components/AdminPanel')
  return { default: module.AdminPanel }
})

type Status =
  | { stage: 'checking' }
  | { stage: 'signed-out' }
  | { stage: 'teams-error'; user: AuthUser; message: string }
  | { stage: 'signed-in'; user: AuthUser; teams: Team[]; activeTeamId: string | null; expired: boolean; teamAccessNotice?: string }

/**
 * Gates the whole app behind sign-in. On first load it checks GET /auth/me
 * once to see whether an existing session cookie is still valid, then either
 * shows the sign-in screen or mounts the real App.
 *
 * A session can also die *while the app is open* (revoked server-side, or
 * the cookie's 30-day lifetime runs out) - `onUnauthenticated` fires whenever
 * any API call comes back 401 AUTHENTICATION_REQUIRED. Rather than unmount
 * App at that point (which would discard whatever the user had open and
 * unsaved), App stays mounted and we show a blocking "session expired"
 * overlay with an embedded sign-in form on top of it. Re-verifying dismisses
 * the overlay without remounting App, so in-memory drafts survive.
 */
export function AuthGate() {
  const [status, setStatus] = useState<Status>({ stage: 'checking' })
  const [adminPanelOpen, setAdminPanelOpen] = useState(false)
  const statusRef = useRef(status)
  const membershipRefreshRef = useRef<Promise<void> | null>(null)
  statusRef.current = status

  async function establishSession(user: AuthUser) {
    resetScopedVariables()
    setActiveTeamId(null)
    try {
      const teams = await teamsApi.list()
      const activeTeamId = chooseActiveTeam(user.id, teams)
      setActiveTeamId(activeTeamId)
      setStatus({ stage: 'signed-in', user, teams, activeTeamId, expired: false })
    } catch (error) {
      setStatus({ stage: 'teams-error', user, message: describeApiError(error) })
    }
  }

  const refreshMembership = useCallback((knownTeams?: Team[]): Promise<void> => {
    if (membershipRefreshRef.current) return membershipRefreshRef.current
    const previous = statusRef.current
    if (previous.stage !== 'signed-in') return Promise.resolve()

    const refresh = (async () => {
      try {
        const teams = knownTeams ?? await teamsApi.list()
        const previousTeam = teams.find(({ id }) => id === previous.activeTeamId)
        const activeTeamId = previousTeam?.id ?? chooseActiveTeam(previous.user.id, teams)
        const teamAccessNotice = previous.activeTeamId && !previousTeam
          ? `You no longer have access to ${previous.teams.find(({ id }) => id === previous.activeTeamId)?.name ?? 'the selected team'}.`
          : undefined
        if (activeTeamId !== previous.activeTeamId) resetScopedVariables()
        setActiveTeamId(activeTeamId)
        setStatus((current) => current.stage === 'signed-in'
          ? { ...current, teams, activeTeamId, teamAccessNotice }
          : current)
      } catch (error) {
        setStatus((current) => current.stage === 'signed-in'
          ? { stage: 'teams-error', user: current.user, message: describeApiError(error) }
          : current)
      }
    })()
    membershipRefreshRef.current = refresh
    void refresh.finally(() => {
      if (membershipRefreshRef.current === refresh) membershipRefreshRef.current = null
    })
    return refresh
  }, [])

  useEffect(() => {
    let cancelled = false
    authApi.me()
      .then(async (user) => {
        if (cancelled) return
        resetScopedVariables()
        setActiveTeamId(null)
        try {
          const teams = await teamsApi.list()
          if (cancelled) return
          const activeTeamId = chooseActiveTeam(user.id, teams)
          setActiveTeamId(activeTeamId)
          setStatus({ stage: 'signed-in', user, teams, activeTeamId, expired: false })
        } catch (error) {
          if (!cancelled) setStatus({ stage: 'teams-error', user, message: describeApiError(error) })
        }
      })
      .catch(() => { if (!cancelled) setStatus({ stage: 'signed-out' }) })
    return () => {
      cancelled = true
      setActiveTeamId(null)
    }
  }, [])

  useEffect(() => {
    return onUnauthenticated(() => {
      setAdminPanelOpen(false)
      setStatus((current) => current.stage === 'signed-in' ? { ...current, expired: true } : current)
    })
  }, [])

  useEffect(() => {
    const onTeamContextError = (event: Event) => {
      const { code, teams } = (event as CustomEvent<{ code: TeamContextErrorCode; teams?: Team[] }>).detail
      if (code === 'TEAM_CONTEXT_REQUIRED' || code === 'TEAM_NOT_FOUND' || code === 'TEAM_MEMBERSHIP_REQUIRED') void refreshMembership(teams)
      if (code === 'TEAM_ROLE_REQUIRED') {
        void refreshMembership().then(() => {
          setStatus((current) => current.stage === 'signed-in'
            ? { ...current, teamAccessNotice: 'You do not have permission in this team.' }
            : current)
        })
      }
    }
    teamContextEvents.addEventListener('team-context-error', onTeamContextError)
    return () => teamContextEvents.removeEventListener('team-context-error', onTeamContextError)
  }, [refreshMembership])

  function handleSignOut() {
    setAdminPanelOpen(false)
    resetScopedVariables()
    setActiveTeamId(null)
    void authApi.signOut().finally(() => setStatus({ stage: 'signed-out' }))
  }

  const leaveAdminPanel = useCallback(() => {
    setAdminPanelOpen(false)
    setStatus((current) => current.stage === 'signed-in'
      ? { ...current, user: { ...current.user, systemRole: 'user' } }
      : current.stage === 'teams-error'
        ? { ...current, user: { ...current.user, systemRole: 'user' } }
        : current)
  }, [])

  if (status.stage === 'checking') {
    return <div className="empty-workspace"><span className="loading-spinner" /><p>Checking session…</p></div>
  }

  if (status.stage === 'signed-out') {
    return <SignIn onSignedIn={(user) => { void establishSession(user) }} />
  }

  if (adminPanelOpen && status.stage === 'teams-error' && status.user.systemRole === 'admin') {
    return (
      <Suspense fallback={<div className="admin-panel"><p>Loading admin panel…</p></div>}>
        <AdminPanel currentUserId={status.user.id} onClose={() => setAdminPanelOpen(false)} onAdminRequired={leaveAdminPanel} />
      </Suspense>
    )
  }

  if (adminPanelOpen && status.stage === 'signed-in' && status.teams.length === 0 && status.user.systemRole === 'admin') {
    return (
      <Suspense fallback={<div className="admin-panel"><p>Loading admin panel…</p></div>}>
        <AdminPanel currentUserId={status.user.id} onClose={() => setAdminPanelOpen(false)} onAdminRequired={leaveAdminPanel} />
      </Suspense>
    )
  }

  if (status.stage === 'teams-error') {
    return (
      <div className="empty-workspace">
        <h1>Couldn’t load your teams</h1>
        <p role="alert">{status.message}</p>
        <button type="button" onClick={() => { void establishSession(status.user) }}>Try again</button>
        {status.user.systemRole === 'admin' && <button type="button" onClick={() => setAdminPanelOpen(true)}>Open admin panel</button>}
      </div>
    )
  }

  if (status.teams.length === 0) {
    return (
      <div className="empty-workspace">
        <h1>No team yet</h1>
        <p>You are not a member of any team yet. Ask an administrator to add you.</p>
        {status.user.systemRole === 'admin' && <button type="button" onClick={() => setAdminPanelOpen(true)}>Open admin panel</button>}
        <button type="button" onClick={handleSignOut}>Sign out</button>
      </div>
    )
  }

  const changeTeam = (teamId: string) => {
    if (!status.teams.some(({ id }) => id === teamId)) return
    saveActiveTeamId(status.user.id, teamId)
    resetScopedVariables()
    setActiveTeamId(teamId)
    setStatus((current) => current.stage === 'signed-in' ? { ...current, activeTeamId: teamId, teamAccessNotice: undefined } : current)
  }

  return (
    <>
      <App
        key={`${status.user.id}:${status.activeTeamId}`}
        user={status.user}
        teams={status.teams}
        activeTeamId={status.activeTeamId}
        teamAccessNotice={status.teamAccessNotice}
        onTeamChange={changeTeam}
        onRefreshTeams={() => refreshMembership()}
        onOpenAdmin={status.user.systemRole === 'admin' ? () => setAdminPanelOpen(true) : undefined}
        onSignOut={handleSignOut}
      />
      {adminPanelOpen && status.user.systemRole === 'admin' && (
        <Suspense fallback={<div className="admin-panel"><p>Loading admin panel…</p></div>}>
          <AdminPanel currentUserId={status.user.id} onClose={() => setAdminPanelOpen(false)} onAdminRequired={leaveAdminPanel} />
        </Suspense>
      )}
      {status.expired && (
        <div className="modal-backdrop">
          <section className="restore-dialog" role="dialog" aria-modal="true" aria-labelledby="session-expired-title">
            <header className="modal-heading">
              <div>
                <h2 id="session-expired-title">Your session has expired</h2>
                <p>Sign in again to keep going. Anything you had open is still here.</p>
              </div>
            </header>
            <SignIn onSignedIn={(user) => { void establishSession(user) }} />
          </section>
        </div>
      )}
    </>
  )
}
