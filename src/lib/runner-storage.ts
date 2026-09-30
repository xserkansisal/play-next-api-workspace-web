// Remembers which runner the user last chose to send requests with.
//
// The choice is a workspace-wide preference rather than a per-request setting: a user who works
// against a CORS-less target sets it once, and every request in that session uses it. Losing it on
// reload forced them to re-pick "Server" on every visit, which was the whole friction.
//
// `localStorage` is right here for the same reason it is right for the collapsed-node set: this is
// a durable preference, not a credential. It records no target and no request content.

import { defaultRunnerId, isRunnerId, type RunnerId } from '@/lib/request-runner'

const STORAGE_KEY = 'play-next-api-workspace.request-runner.v1'

export function loadRunnerId(): RunnerId {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    // An unknown value must not select a runner that no longer exists, so fall back rather than
    // trusting whatever happens to be stored.
    return raw && isRunnerId(raw) ? raw : defaultRunnerId
  } catch {
    return defaultRunnerId
  }
}

export function saveRunnerId(id: RunnerId): void {
  try {
    if (id === defaultRunnerId) {
      // Storing the default would pin it, so a later change of default could never reach an
      // existing user. Absence already means "the default".
      window.localStorage.removeItem(STORAGE_KEY)
      return
    }
    window.localStorage.setItem(STORAGE_KEY, id)
  } catch {
    // A full or unavailable store must not break sending; the choice just will not survive.
  }
}
