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
  })

  it('provides light and dark logo assets on the sign-in screen', () => {
    const { container } = render(<SignIn onSignedIn={vi.fn()} />)

    expect(container.querySelector('.sign-in-logo-light')).toHaveAttribute('src', '/assets/play-next-logo.png')
    expect(container.querySelector('.sign-in-logo-dark')).toHaveAttribute('src', '/assets/play-next-logo-dark.png')
  })

  it('requests a code, then reports the specific domain-rejection error', async () => {
    const requestCode = vi.spyOn(authApi, 'requestCode').mockRejectedValue(authErrorResponse(400, 'EMAIL_DOMAIN_NOT_ALLOWED', 'Domain not allowed'))
    const user = userEvent.setup()
    render(<SignIn onSignedIn={vi.fn()} />)
    await user.type(screen.getByLabelText('Email'), 'someone@example.com')
    await user.click(screen.getByRole('button', { name: 'Send code' }))
    expect(requestCode).toHaveBeenCalledWith('someone@example.com')
    expect(await screen.findByRole('alert')).toHaveTextContent(/domain is not allowed/i)
  })

  it('advances to the code step and calls onSignedIn once verification succeeds', async () => {
    vi.spyOn(authApi, 'requestCode').mockResolvedValue(undefined)
    const verifyCode = vi.spyOn(authApi, 'verifyCode').mockResolvedValue({ id: 'u1', email: 'a@sisal.com' })
    const onSignedIn = vi.fn()
    const user = userEvent.setup()
    render(<SignIn onSignedIn={onSignedIn} />)
    await user.type(screen.getByLabelText('Email'), 'a@sisal.com')
    await user.click(screen.getByRole('button', { name: 'Send code' }))
    await user.type(await screen.findByLabelText('6-digit code'), '123456')
    await user.click(screen.getByRole('button', { name: 'Verify code' }))
    expect(verifyCode).toHaveBeenCalledWith('a@sisal.com', '123456')
    expect(onSignedIn).toHaveBeenCalledWith({ id: 'u1', email: 'a@sisal.com' })
  })

  it('invalidates the code client-side after 5 wrong attempts, since the API returns the same error for wrong, expired, and exhausted codes', async () => {
    vi.spyOn(authApi, 'requestCode').mockResolvedValue(undefined)
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
    vi.spyOn(authApi, 'requestCode').mockResolvedValue(undefined)
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
