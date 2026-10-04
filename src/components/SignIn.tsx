import { useEffect, useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import { GlassBackdrop } from '@/components/GlassBackdrop'
import { ThemeToggle } from '@/components/ThemeToggle'
import { authApi, describeAuthError } from '@/lib/auth'
import type { AuthUser } from '@/lib/auth'

const MAX_CODE_ATTEMPTS = 5
const FEATURE_ROTATION_MS = 6500

const signInFeatures = [
  {
    icon: '⌁',
    title: 'Work together in real time',
    description: 'See who’s viewing a resource and keep up with team changes as they happen.',
  },
  {
    icon: '{ }',
    title: 'Turn OpenAPI into runnable requests',
    description: 'Import a spec, preview changes and sync operations with your collection.',
  },
  {
    icon: '✓',
    title: 'Test more than the response code',
    description: 'Run collections and folders with scripts and assertions.',
  },
  {
    icon: '↶',
    title: 'Recover with version history',
    description: 'Review request changes and restore collection snapshots when needed.',
  },
  {
    icon: '◉',
    title: 'Keep environments with your team',
    description: 'Manage shared environments and resolve variables right in your requests.',
  },
  {
    icon: '⌘',
    title: 'Reuse scripts across your team',
    description: 'Share pre-request and post-response scripts across requests.',
  },
  {
    icon: '⇄',
    title: 'Bring your Postman workspace',
    description: 'Import and export collections and environments.',
  },
  {
    icon: '♙',
    title: 'Give teammates the right access',
    description: 'Organize teams with owner, member and viewer roles.',
  },
]

function SignInFeatureSpotlight() {
  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    let timer: number | undefined

    const stop = () => {
      if (timer !== undefined) {
        window.clearInterval(timer)
        timer = undefined
      }
    }
    const start = () => {
      if (document.hidden || timer !== undefined) return
      timer = window.setInterval(() => {
        setActiveIndex((index) => (index + 1) % signInFeatures.length)
      }, FEATURE_ROTATION_MS)
    }
    const onVisibilityChange = () => {
      if (document.hidden) stop()
      else start()
    }

    start()
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  return (
    <section className="sign-in-feature-spotlight" role="group" aria-label="Workspace features">
      <p className="sign-in-feature-heading"><span aria-hidden="true">✦</span> What you can do here</p>
      <div className="sign-in-feature-slides" aria-live="off">
        {signInFeatures.map((feature, index) => (
          <div
            className={`sign-in-feature-slide ${index === activeIndex ? 'is-active' : ''}`}
            key={feature.title}
            role="group"
            aria-roledescription="slide"
            aria-label={feature.title}
            aria-hidden={index !== activeIndex}
          >
            <span className="sign-in-feature-icon" aria-hidden="true">{feature.icon}</span>
            <span>
              <strong>{feature.title}</strong>
              <small>{feature.description}</small>
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}

function devLoginEnabled(): boolean {
  return import.meta.env.DEV && import.meta.env.VITE_DEV_LOGIN === 'true'
}

function authErrorMessage(error: unknown): string {
  const info = describeAuthError(error)
  return info.code === 'EMAIL_DOMAIN_NOT_ALLOWED'
    ? 'This email domain is not allowed to sign in. Use an address ending in @fluttersea.com, @sisal.com, or @sisal.it.'
    : info.code === 'AUTH_RATE_LIMITED'
      ? 'Too many code requests for this address. Please wait a few minutes before trying again.'
      : info.code === 'AUTH_DELIVERY_FAILED'
        ? "We couldn't send the sign-in code. Please try again shortly."
        : info.code === 'VALIDATION_ERROR'
          ? 'Enter a valid email address.'
          : info.message
}

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
      const canonicalEmail = await authApi.requestCode(targetEmail)
      setStep({ stage: 'code', email: canonicalEmail, attempts: 0, codeDead: false })
      setCode('')
      setNotice(resend ? 'A new code has been sent. The previous code no longer works.' : `We sent a code to ${canonicalEmail}. It is valid for 15 minutes.`)
    } catch (submitError) {
      setError(authErrorMessage(submitError))
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
    if (devLoginEnabled()) {
      setPending(true)
      setError(null)
      setNotice(null)
      try {
        const user = await authApi.devLogin(trimmed)
        onSignedIn(user)
        return
      } catch (submitError) {
        if (describeAuthError(submitError).status !== 404) {
          setError(authErrorMessage(submitError))
          return
        }
      } finally {
        setPending(false)
      }
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
        <GlassBackdrop />
        <form className="sign-in-card" onSubmit={(event) => void submitEmail(event)}>
          <ThemeToggle />
          <img className="sign-in-logo sign-in-logo-light" src="/assets/play-next-logo.png" alt="Play Next" />
          <img className="sign-in-logo sign-in-logo-dark" src="/assets/play-next-logo-dark.png" alt="" aria-hidden="true" />
          <h1>Sign in to Play Next API Workspace</h1>
          <p>Enter your work email. We'll send a 6-digit sign-in code.</p>
          <label className="field-label">
            Email
            <input
              className="text-field"
              type="email"
              autoFocus
              autoComplete="email"
              placeholder="you@fluttersea.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          {error && <p className="inline-error" role="alert">{error}</p>}
          <Button type="submit" disabled={pending}>{pending ? 'Sending…' : 'Send code'}</Button>
          <SignInFeatureSpotlight />
        </form>
      </div>
    )
  }

  return (
    <div className="sign-in-screen">
      <GlassBackdrop />
      <form className="sign-in-card" onSubmit={(event) => void submitCode(event)}>
        <ThemeToggle />
        <img className="sign-in-logo sign-in-logo-light" src="/assets/play-next-logo.png" alt="Play Next" />
        <img className="sign-in-logo sign-in-logo-dark" src="/assets/play-next-logo-dark.png" alt="" aria-hidden="true" />
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
