import { useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import { ThemeToggle } from '@/components/ThemeToggle'
import { authApi, describeAuthError } from '@/lib/auth'
import type { AuthUser } from '@/lib/auth'

const MAX_CODE_ATTEMPTS = 5

interface SignInProps {
  onSignedIn: (user: AuthUser) => void
}

type Step =
  | { stage: 'email' }
  | { stage: 'code'; email: string; attempts: number; codeDead: boolean }

export function SignIn({ onSignedIn }: SignInProps) {
  const [step, setStep] = useState<Step>({ stage: 'email' })
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function requestCode(targetEmail: string, resend: boolean) {
    setPending(true)
    setError(null)
    setNotice(null)
    try {
      await authApi.requestCode(targetEmail)
      setStep({ stage: 'code', email: targetEmail, attempts: 0, codeDead: false })
      setCode('')
      setNotice(resend ? 'A new code has been sent. The previous code no longer works.' : 'If that address is eligible, a 6-digit code has been sent. It is valid for 15 minutes.')
    } catch (submitError) {
      const info = describeAuthError(submitError)
      setError(
        info.code === 'EMAIL_DOMAIN_NOT_ALLOWED'
          ? 'This email domain is not allowed to sign in. Use an address ending in @fluttersea.com, @sisal.com, or @sisal.it.'
          : info.code === 'AUTH_RATE_LIMITED'
            ? 'Too many code requests for this address. Please wait a few minutes before trying again.'
            : info.code === 'AUTH_DELIVERY_FAILED'
              ? "We couldn't send the sign-in code. Please try again shortly."
              : info.code === 'VALIDATION_ERROR'
                ? 'Enter a valid email address.'
                : info.message,
      )
    } finally {
      setPending(false)
    }
  }

  async function submitEmail(event: FormEvent) {
    event.preventDefault()
    const trimmed = email.trim()
    if (!trimmed) {
      setError('Enter your email address.')
      return
    }
    await requestCode(trimmed, false)
  }

  async function submitCode(event: FormEvent) {
    event.preventDefault()
    if (step.stage !== 'code' || step.codeDead) return
    setPending(true)
    setError(null)
    try {
      const user = await authApi.verifyCode(step.email, code)
      onSignedIn(user)
    } catch (submitError) {
      const info = describeAuthError(submitError)
      if (info.code === 'AUTH_RATE_LIMITED') {
        setError('Too many attempts. Please wait a few minutes before trying again.')
      } else {
        // The API deliberately does not say whether this particular attempt
        // was wrong, the code expired, or the code already hit its 5-attempt
        // limit - all three come back as the same INVALID_OR_EXPIRED_CODE.
        // We track attempts against this code ourselves so we can at least
        // tell the user plainly once they have almost certainly exhausted it
        // server-side too (the server's limit is also 5).
        const nextAttempts = step.attempts + 1
        const dead = nextAttempts >= MAX_CODE_ATTEMPTS
        setStep({ ...step, attempts: nextAttempts, codeDead: dead })
        setError(
          dead
            ? 'That code has been entered incorrectly too many times and is no longer valid. Request a new code to continue.'
            : `That code is incorrect or has expired. ${MAX_CODE_ATTEMPTS - nextAttempts} attempt${MAX_CODE_ATTEMPTS - nextAttempts === 1 ? '' : 's'} left before this code is invalidated.`,
        )
      }
    } finally {
      setPending(false)
    }
  }

  if (step.stage === 'email') {
    return (
      <div className="sign-in-screen">
        <form className="sign-in-card" onSubmit={(event) => void submitEmail(event)}>
          <ThemeToggle />
          <img className="sign-in-logo" src="/assets/play-next-logo.png" alt="Play Next" />
          <h1>Sign in to Play Next API Workspace</h1>
          <p>Enter your work email. We'll send a 6-digit sign-in code.</p>
          <label className="field-label">
            Email
            <input
              className="text-field"
              type="email"
              autoFocus
              autoComplete="email"
              placeholder="you@sisal.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          {error && <p className="inline-error" role="alert">{error}</p>}
          <Button type="submit" disabled={pending}>{pending ? 'Sending…' : 'Send code'}</Button>
        </form>
      </div>
    )
  }

  return (
    <div className="sign-in-screen">
      <form className="sign-in-card" onSubmit={(event) => void submitCode(event)}>
        <ThemeToggle />
        <img className="sign-in-logo" src="/assets/play-next-logo.png" alt="Play Next" />
        <h1>Enter your code</h1>
        <p>We sent a 6-digit code to <strong>{step.email}</strong>. It expires 15 minutes after it was sent.</p>
        <label className="field-label">
          6-digit code
          <input
            className="text-field"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            autoFocus
            disabled={step.codeDead}
            value={code}
            onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
          />
        </label>
        {notice && !error && <p role="status">{notice}</p>}
        {error && <p className="inline-error" role="alert">{error}</p>}
        <div className="sign-in-actions">
          <Button type="submit" disabled={pending || step.codeDead || code.length !== 6}>{pending ? 'Verifying…' : 'Verify code'}</Button>
          <Button type="button" variant="outline" disabled={pending} onClick={() => void requestCode(step.email, true)}>Resend code</Button>
        </div>
        <button type="button" className="link-button" onClick={() => setStep({ stage: 'email' })}>Use a different email</button>
      </form>
    </div>
  )
}
