import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AxiosError, AxiosHeaders } from 'axios'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SignIn } from '@/components/SignIn'
import { authApi } from '@/lib/auth'

function authErrorResponse(status: number, code: string, message: string) {
  const config = { headers: new AxiosHeaders() }
  return new AxiosError('Request failed', String(status), config, null, {
    status,
    statusText: 'Error',
    data: { error: { code, message } },
    headers: {},
    config,
  })
}

describe('SignIn', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('provides light and dark logo assets on the sign-in screen', () => {
    const { container } = render(<SignIn onSignedIn={vi.fn()} />)

    expect(container.querySelector('.sign-in-logo-light')).toHaveAttribute('src', '/assets/play-next-logo.png')
    expect(container.querySelector('.sign-in-logo-dark')).toHaveAttribute('src', '/assets/play-next-logo-dark.png')
  })

  it('requests a code, then reports the specific domain-rejection error', async () => {
    vi.stubEnv('VITE_DEV_LOGIN', 'false')
    const requestCode = vi.spyOn(authApi, 'requestCode').mockRejectedValue(authErrorResponse(400, 'EMAIL_DOMAIN_NOT_ALLOWED', 'Domain not allowed'))
    const user = userEvent.setup()
    render(<SignIn onSignedIn={vi.fn()} />)
    await user.type(screen.getByLabelText('Email'), 'someone@example.com')
    await user.click(screen.getByRole('button', { name: 'Send code' }))
    expect(requestCode).toHaveBeenCalledWith('someone@example.com')
    expect(await screen.findByRole('alert')).toHaveTextContent(/domain is not allowed/i)
  })

  it('signs in directly in development when dev login is enabled', async () => {
    vi.stubEnv('DEV', true)
    vi.stubEnv('VITE_DEV_LOGIN', 'true')
    const devLogin = vi.spyOn(authApi, 'devLogin').mockResolvedValue({ id: 'u1', email: 'a@sisal.com' })
    const requestCode = vi.spyOn(authApi, 'requestCode').mockResolvedValue('a@fluttersea.com')
    const onSignedIn = vi.fn()
    const user = userEvent.setup()
    render(<SignIn onSignedIn={onSignedIn} />)
    await user.type(screen.getByLabelText('Email'), 'a@sisal.com')
    await user.click(screen.getByRole('button', { name: 'Send code' }))

    expect(devLogin).toHaveBeenCalledWith('a@sisal.com')
    expect(requestCode).not.toHaveBeenCalled()
    expect(onSignedIn).toHaveBeenCalledWith({ id: 'u1', email: 'a@sisal.com' })
    expect(screen.queryByLabelText('6-digit code')).not.toBeInTheDocument()
  })

  it('falls back to requesting a code when dev login is unavailable', async () => {
    vi.stubEnv('DEV', true)
    vi.stubEnv('VITE_DEV_LOGIN', 'true')
    vi.spyOn(authApi, 'devLogin').mockRejectedValue(authErrorResponse(404, 'NOT_FOUND', 'Not found'))
    const requestCode = vi.spyOn(authApi, 'requestCode').mockResolvedValue('a@fluttersea.com')
    const user = userEvent.setup()
    render(<SignIn onSignedIn={vi.fn()} />)
    await user.type(screen.getByLabelText('Email'), 'a@sisal.com')
    await user.click(screen.getByRole('button', { name: 'Send code' }))

    expect(requestCode).toHaveBeenCalledWith('a@sisal.com')
    expect(await screen.findByLabelText('6-digit code')).toBeInTheDocument()
  })

  it('does not request a code when dev login fails with a non-404 error', async () => {
    vi.stubEnv('DEV', true)
    vi.stubEnv('VITE_DEV_LOGIN', 'true')
    vi.spyOn(authApi, 'devLogin').mockRejectedValue(authErrorResponse(400, 'EMAIL_DOMAIN_NOT_ALLOWED', 'Domain not allowed'))
    const requestCode = vi.spyOn(authApi, 'requestCode').mockResolvedValue('a@fluttersea.com')
    const user = userEvent.setup()
    render(<SignIn onSignedIn={vi.fn()} />)
    await user.type(screen.getByLabelText('Email'), 'someone@example.com')
    await user.click(screen.getByRole('button', { name: 'Send code' }))

    expect(requestCode).not.toHaveBeenCalled()
    expect(await screen.findByRole('alert')).toHaveTextContent(/domain is not allowed/i)
  })

  it('advances to the code step and calls onSignedIn once verification succeeds', async () => {
    vi.spyOn(authApi, 'requestCode').mockResolvedValue('a@fluttersea.com')
    const verifyCode = vi.spyOn(authApi, 'verifyCode').mockResolvedValue({ id: 'u1', email: 'a@fluttersea.com' })
    const onSignedIn = vi.fn()
    const user = userEvent.setup()
    render(<SignIn onSignedIn={onSignedIn} />)
    await user.type(screen.getByLabelText('Email'), 'a@sisal.com')
    await user.click(screen.getByRole('button', { name: 'Send code' }))
    expect(await screen.findByText(/We sent a code to a@fluttersea\.com/)).toBeInTheDocument()
    await user.type(await screen.findByLabelText('6-digit code'), '123456')
    await user.click(screen.getByRole('button', { name: 'Verify code' }))
    expect(verifyCode).toHaveBeenCalledWith('a@fluttersea.com', '123456')
    expect(onSignedIn).toHaveBeenCalledWith({ id: 'u1', email: 'a@fluttersea.com' })
  })

  it('invalidates the code client-side after 5 wrong attempts, since the API returns the same error for wrong, expired, and exhausted codes', async () => {
    vi.spyOn(authApi, 'requestCode').mockResolvedValue('a@fluttersea.com')
    vi.spyOn(authApi, 'verifyCode').mockRejectedValue(authErrorResponse(401, 'INVALID_OR_EXPIRED_CODE', 'Invalid or expired code'))
    const user = userEvent.setup()
    render(<SignIn onSignedIn={vi.fn()} />)
    await user.type(screen.getByLabelText('Email'), 'a@sisal.com')
    await user.click(screen.getByRole('button', { name: 'Send code' }))
    const codeInput = await screen.findByLabelText('6-digit code')

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      await user.clear(codeInput)
      await user.type(codeInput, String(attempt).padStart(6, '0'))
      await user.click(screen.getByRole('button', { name: 'Verify code' }))
      expect(await screen.findByRole('alert')).toHaveTextContent(`${5 - attempt} attempt`)
    }

    await user.clear(codeInput)
    await user.type(codeInput, '000005')
    await user.click(screen.getByRole('button', { name: 'Verify code' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/no longer valid/i)
    expect(codeInput).toBeDisabled()
  })

  it('shows a distinct rate-limit message and resend resets the dead-code state', async () => {
    vi.spyOn(authApi, 'requestCode').mockResolvedValue('a@fluttersea.com')
    vi.spyOn(authApi, 'verifyCode').mockRejectedValue(authErrorResponse(429, 'AUTH_RATE_LIMITED', 'Too many attempts'))
    const user = userEvent.setup()
    render(<SignIn onSignedIn={vi.fn()} />)
    await user.type(screen.getByLabelText('Email'), 'a@sisal.com')
    await user.click(screen.getByRole('button', { name: 'Send code' }))
    await user.type(await screen.findByLabelText('6-digit code'), '123456')
    await user.click(screen.getByRole('button', { name: 'Verify code' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/too many attempts/i)

    await user.click(screen.getByRole('button', { name: 'Resend code' }))
    expect(await screen.findByText(/new code has been sent/i)).toBeInTheDocument()
    expect(screen.getByLabelText('6-digit code')).toBeEnabled()
  })
})
