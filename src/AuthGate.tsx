import { useEffect, useState } from 'react'

import App from '@/App'
import { SignIn } from '@/components/SignIn'
import { authApi, onUnauthenticated } from '@/lib/auth'
import type { AuthUser } from '@/lib/auth'

type Status =
  | { stage: 'checking' }
  | { stage: 'signed-out' }
  | { stage: 'signed-in'; user: AuthUser; expired: boolean }

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

  useEffect(() => {
    let cancelled = false
    authApi.me()
      .then((user) => { if (!cancelled) setStatus({ stage: 'signed-in', user, expired: false }) })
      .catch(() => { if (!cancelled) setStatus({ stage: 'signed-out' }) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    return onUnauthenticated(() => {
      setStatus((current) => current.stage === 'signed-in' ? { ...current, expired: true } : current)
    })
  }, [])

  function handleSignOut() {
    void authApi.signOut().finally(() => setStatus({ stage: 'signed-out' }))
  }

  if (status.stage === 'checking') {
    return <div className="empty-workspace"><span className="loading-spinner" /><p>Checking session…</p></div>
  }

  if (status.stage === 'signed-out') {
    return <SignIn onSignedIn={(user) => setStatus({ stage: 'signed-in', user, expired: false })} />
  }

  return (
    <>
      <App user={status.user} onSignOut={handleSignOut} />
      {status.expired && (
        <div className="modal-backdrop">
          <section className="restore-dialog" role="dialog" aria-modal="true" aria-labelledby="session-expired-title">
            <header className="modal-heading">
              <div>
                <h2 id="session-expired-title">Your session has expired</h2>
                <p>Sign in again to keep going. Anything you had open is still here.</p>
              </div>
            </header>
            <SignIn onSignedIn={(user) => setStatus({ stage: 'signed-in', user, expired: false })} />
          </section>
        </div>
      )}
    </>
  )
}
