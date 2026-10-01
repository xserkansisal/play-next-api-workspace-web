import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { UserProfileMenu } from '@/components/UserProfileMenu'
import { authApi } from '@/lib/auth'

describe('UserProfileMenu', () => {
  it('shows sign out inside the open profile panel', async () => {
    const user = userEvent.setup()
    const onSignOut = vi.fn()
    render(<UserProfileMenu user={{ id: 'u1', email: 'serkan.taghan@sisal.com' }} onSignOut={onSignOut} />)

    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /serkan\.taghan@sisal\.com/i }))
    await user.click(screen.getByRole('button', { name: 'Sign out' }))

    expect(onSignOut).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog', { name: 'User profile' })).not.toBeInTheDocument()
  })

  it('opens read-only profile details and derives names from the email when the API omits them', async () => {
    const user = userEvent.setup()
    render(<UserProfileMenu user={{ id: 'u1', email: 'serkan.taghan@sisal.com' }} />)

    await user.click(screen.getByRole('button', { name: /serkan\.taghan@sisal\.com/i }))

    expect(screen.getByRole('dialog', { name: 'User profile' })).toBeInTheDocument()
    expect(screen.getByText('Serkan Taghan')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'First name' })).toHaveValue('Serkan')
    expect(screen.getByRole('textbox', { name: 'Last name' })).toHaveValue('Taghan')
    expect(screen.getByRole('textbox', { name: 'Email' })).toHaveValue('serkan.taghan@sisal.com')
    expect(screen.getByRole('textbox', { name: 'First name' })).toBeDisabled()
    expect(screen.getByRole('textbox', { name: 'Last name' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Upload photo' })).toBeEnabled()
    expect(screen.getByRole('group', { name: 'Avatar color' })).toBeInTheDocument()
  })

  it('uses the profile names returned by the API', async () => {
    const user = userEvent.setup()
    render(<UserProfileMenu user={{
      id: 'u1',
      email: 's.taghan@sisal.com',
      firstName: 'Serkan',
      lastName: 'Taghan',
    }} />)

    await user.click(screen.getByRole('button', { name: /s\.taghan@sisal\.com/i }))

    expect(screen.getByRole('textbox', { name: 'First name' })).toHaveValue('Serkan')
    expect(screen.getByRole('textbox', { name: 'Last name' })).toHaveValue('Taghan')
  })

  it('closes the profile panel with Escape and an outside click', async () => {
    const user = userEvent.setup()
    render(
      <>
        <UserProfileMenu user={{ id: 'u1', email: 'serkan.taghan@sisal.com' }} />
        <button type="button">Outside</button>
      </>,
    )
    const trigger = screen.getByRole('button', { name: /serkan\.taghan@sisal\.com/i })

    await user.click(trigger)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'User profile' })).not.toBeInTheDocument()

    await user.click(trigger)
    await user.click(screen.getByRole('button', { name: 'Outside' }))
    expect(screen.queryByRole('dialog', { name: 'User profile' })).not.toBeInTheDocument()
  })

  it('uploads a supported image and displays the saved profile photo', async () => {
    const user = userEvent.setup()
    vi.spyOn(authApi, 'uploadAvatar').mockResolvedValue({
      id: 'u1',
      email: 'serkan.taghan@sisal.com',
      avatarUrl: 'https://api.example.com/avatars/u1.png',
      avatarColor: 'violet',
    })
    const { container } = render(<UserProfileMenu user={{ id: 'u1', email: 'serkan.taghan@sisal.com' }} />)
    await user.click(screen.getByRole('button', { name: /serkan\.taghan@sisal\.com/i }))
    const image = new File(['image bytes'], 'avatar.png', { type: 'image/png' })
    await user.upload(screen.getByLabelText('Choose profile photo'), image)

    expect(authApi.uploadAvatar).toHaveBeenCalledWith(image)
    expect(container.querySelector('.profile-panel-heading img')).toHaveAttribute('src', 'https://api.example.com/avatars/u1.png')
    expect(screen.getByRole('button', { name: 'Change photo' })).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Avatar color' })).not.toBeInTheDocument()
  })

  it('saves a selected fallback avatar color', async () => {
    const user = userEvent.setup()
    vi.spyOn(authApi, 'setAvatarColor').mockResolvedValue({
      id: 'u1',
      email: 'serkan.taghan@sisal.com',
      avatarColor: 'green',
    })
    render(<UserProfileMenu user={{ id: 'u1', email: 'serkan.taghan@sisal.com' }} />)
    await user.click(screen.getByRole('button', { name: /serkan\.taghan@sisal\.com/i }))
    await user.click(screen.getByRole('button', { name: 'green avatar color' }))

    expect(authApi.setAvatarColor).toHaveBeenCalledWith('green')
    expect(screen.getByRole('button', { name: 'green avatar color' })).toHaveAttribute('aria-pressed', 'true')
  })
})
