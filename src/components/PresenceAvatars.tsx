import { UserAvatar } from '@/components/UserAvatar'
import type { PresenceUser } from '@/lib/presence'

export function PresenceAvatars({ users, compact = false }: { users: PresenceUser[]; compact?: boolean }) {
  if (!users.length) return null
  const names = users.map(({ firstName, lastName }) =>
    [firstName, lastName].filter(Boolean).join(' ') || 'Team member',
  )
  const label = `Viewing now: ${names.join(', ')}`

  return (
    <span className={`presence-avatars ${compact ? 'compact' : ''}`} role="img" aria-label={label} title={label}>
      {users.slice(0, 3).map((user) => (
        <UserAvatar
          key={user.userId}
          {...user}
          email={user.firstName ?? user.userId}
          className="presence-avatar"
        />
      ))}
      {users.length > 3 && <span className="presence-overflow">+{users.length - 3}</span>}
    </span>
  )
}
