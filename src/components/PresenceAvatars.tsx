import { UserAvatar } from '@/components/UserAvatar'
import type { NestedPresence, PresenceUser } from '@/lib/presence'

function displayName({ firstName, lastName }: PresenceUser): string {
  return [firstName, lastName].filter(Boolean).join(' ') || 'Team member'
}

export function PresenceAvatars({ users, compact = false }: { users: PresenceUser[]; compact?: boolean }) {
  if (!users.length) return null
  const label = `Viewing now: ${users.map(displayName).join(', ')}`

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

/** Users viewing something inside a collapsed-or-not parent row, styled apart from direct viewers. */
export function NestedPresenceAvatars({ entries }: { entries: NestedPresence[] }) {
  if (!entries.length) return null
  const lines = entries.map(({ user, path }) => `${displayName(user)} → ${path.join(' / ')}`)
  const label = `Viewing inside: ${lines.join('; ')}`

  return (
    <span className="presence-avatars nested" role="img" aria-label={label} title={`Viewing inside:\n${lines.join('\n')}`}>
      <span className="presence-nested-mark" aria-hidden="true">↳</span>
      {entries.slice(0, 2).map(({ user }) => (
        <UserAvatar
          key={user.userId}
          {...user}
          email={user.firstName ?? user.userId}
          className="presence-avatar"
        />
      ))}
      {entries.length > 2 && <span className="presence-nested-count">+{entries.length - 2}</span>}
    </span>
  )
}
