import type { CSSProperties } from 'react'

import { avatarColorFor, avatarColors, isAvatarColor } from '@/lib/avatar'

interface UserAvatarProps {
  email?: string
  firstName?: string | null
  lastName?: string | null
  avatarUrl?: string | null
  avatarColor?: string | null
  className?: string
}

export function UserAvatar({ email, firstName, lastName, avatarUrl, avatarColor, className = '' }: UserAvatarProps) {
  const color = avatarColors[avatarColorFor(isAvatarColor(avatarColor) ? avatarColor : email ?? firstName ?? 'user')]
  const initials = `${firstName?.trim().charAt(0) ?? ''}${lastName?.trim().charAt(0) ?? ''}` ||
    (email ?? 'U').charAt(0).toUpperCase()

  return (
    <span
      className={`user-avatar ${className}`.trim()}
      aria-hidden="true"
      style={{
        '--avatar-bg': color.background,
        '--avatar-fg': color.foreground,
      } as CSSProperties}
    >
      {avatarUrl
        ? <img src={avatarUrl} alt="" />
        : initials.toUpperCase()}
    </span>
  )
}
