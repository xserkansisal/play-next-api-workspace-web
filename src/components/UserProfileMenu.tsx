import { useEffect, useRef, useState, type CSSProperties } from 'react'

import { UserAvatar } from '@/components/UserAvatar'
import { describeApiError } from '@/lib/api'
import { avatarColors, isAvatarColor, type AvatarColor } from '@/lib/avatar'
import { authApi, nameFromEmail } from '@/lib/auth'
import type { AuthUser } from '@/lib/auth'

interface UserProfileMenuProps {
  user: AuthUser
  onSignOut?: () => void
}

const imageTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])
const maxAvatarBytes = 5 * 1024 * 1024

export function UserProfileMenu({ user, onSignOut }: UserProfileMenuProps) {
  const [open, setOpen] = useState(false)
  const [profile, setProfile] = useState(user)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const fallbackName = nameFromEmail(profile.email)
  const firstName = profile.firstName?.trim() || fallbackName.firstName
  const lastName = profile.lastName?.trim() || fallbackName.lastName
  const currentColor = isAvatarColor(profile.avatarColor) ? profile.avatarColor : null

  useEffect(() => setProfile(user), [user])

  useEffect(() => {
    if (!open) return

    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('pointerdown', closeOnOutsidePointer)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  async function updateProfile(update: () => Promise<AuthUser>) {
    setSaving(true)
    setError(null)
    try {
      const nextUser = await update()
      setProfile(nextUser)
    } catch (cause) {
      setError(describeApiError(cause))
    } finally {
      setSaving(false)
    }
  }

  async function selectAvatar(file: File | undefined) {
    if (!file) return
    if (!imageTypes.has(file.type)) {
      setError('Choose a JPEG, PNG or WebP image.')
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }
    if (file.size > maxAvatarBytes) {
      setError('The image must be 5 MB or smaller.')
      if (fileInputRef.current) fileInputRef.current.value = ''
      return
    }
    await updateProfile(() => authApi.uploadAvatar(file))
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div className="profile-menu" ref={rootRef}>
      <button
        className="account-email"
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls="user-profile-panel"
        onClick={() => setOpen((current) => !current)}
        title={profile.email}
      >
        <UserAvatar {...profile} className="account-avatar" />
        <span>{profile.email}</span>
        <svg className="profile-chevron" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path d="m4 6 4 4 4-4" />
        </svg>
      </button>
      {open && (
        <section
          className="profile-panel"
          id="user-profile-panel"
          role="dialog"
          aria-label="User profile"
        >
          <div className="profile-panel-heading">
            <UserAvatar {...profile} className="profile-avatar" />
            <div>
              <strong>{[firstName, lastName].filter(Boolean).join(' ') || profile.email}</strong>
              <p>Profile details</p>
            </div>
          </div>
          <div className="profile-fields">
            <label>
              First name
              <input type="text" value={firstName} disabled />
            </label>
            <label>
              Last name
              <input type="text" value={lastName} disabled />
            </label>
            <label>
              Email
              <input type="email" value={profile.email} disabled />
            </label>
          </div>
          <section className="profile-avatar-settings" aria-label="Profile photo and avatar">
            <h3>Profile photo</h3>
            <p>JPEG, PNG or WebP · up to 5 MB</p>
            <div className="profile-avatar-actions">
              <input
                ref={fileInputRef}
                className="profile-file-input"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                aria-label="Choose profile photo"
                disabled={saving}
                onChange={(event) => void selectAvatar(event.target.files?.[0])}
              />
              <button type="button" disabled={saving} onClick={() => fileInputRef.current?.click()}>
                {profile.avatarUrl ? 'Change photo' : 'Upload photo'}
              </button>
              {profile.avatarUrl && (
                <button type="button" disabled={saving} onClick={() => void updateProfile(() => authApi.removeAvatar())}>
                  Remove
                </button>
              )}
            </div>
            {!profile.avatarUrl && (
              <div className="avatar-color-picker">
                <span>Avatar color</span>
                <div role="group" aria-label="Avatar color">
                  {(Object.keys(avatarColors) as AvatarColor[]).map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={`avatar-color-option ${currentColor === color ? 'selected' : ''}`}
                      style={{ '--avatar-bg': avatarColors[color].background, '--avatar-fg': avatarColors[color].foreground } as CSSProperties}
                      aria-label={`${color} avatar color`}
                      aria-pressed={currentColor === color}
                      disabled={saving}
                      onClick={() => void updateProfile(() => authApi.setAvatarColor(color))}
                    >
                      A
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>
          <div className="profile-panel-footer">
            <span>Names and email are read-only.</span>
            <span>Avatar: {saving ? 'Saving…' : 'Saved to profile'}</span>
          </div>
          {onSignOut && (
            <div className="profile-panel-actions">
              <button
                className="profile-sign-out"
                type="button"
                onClick={() => {
                  setOpen(false)
                  onSignOut()
                }}
              >
                Sign out
              </button>
            </div>
          )}
          {error && <p className="profile-error" role="alert">{error}</p>}
        </section>
      )}
    </div>
  )
}
