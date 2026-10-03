// Captured values, held server-side at one of two scopes and mirrored here so React can read them
// synchronously while rendering.
//
// Decisions (reported to the user):
// - These used to live in `sessionStorage`, per tab, and died when the tab closed. "User scope"
//   now means what it says: the value belongs to the signed-in account and follows them across
//   tabs, reloads and machines. `migrateLegacyRuntimeVariables` carries over anything a tab was
//   still holding when this shipped, so nobody loses a value they had already captured.
// - Writes are optimistic *and* confirmed: the cache updates at once so the UI never lags, but a
//   rejected write is rolled back and rethrown. A value silently not saved is worse than an
//   error, because the next request would quietly send the old one.
// - Values are stored in the API's database in plain text, exactly as environment variables
//   already are. Anything genuinely secret is no safer here than it is there.

import { workspaceApi } from '@/lib/api'
import { getActiveTeamId } from '@/lib/teams'
import type { ScopedVariable, VariableScope } from '@/lib/variable-scopes'

const LEGACY_STORAGE_KEY = 'play-next-api-workspace.runtime-variables.v1'

const EMPTY: readonly ScopedVariable[] = Object.freeze([])

let cache: readonly ScopedVariable[] = EMPTY
let cacheGeneration = 0
const listeners = new Set<() => void>()

function publish(next: readonly ScopedVariable[]) {
  cache = Object.freeze([...next].sort((a, b) => a.scope.localeCompare(b.scope) || a.key.localeCompare(b.key)))
  for (const listener of listeners) listener()
}

/** Stable snapshot suitable for `useSyncExternalStore`. */
export function getScopedVariables(): readonly ScopedVariable[] {
  return cache
}

export function subscribeScopedVariables(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export async function loadScopedVariables(): Promise<void> {
  const teamId = getActiveTeamId()
  const generation = cacheGeneration
  const variables = await workspaceApi.variables()
  if (generation !== cacheGeneration || teamId !== getActiveTeamId()) return
  publish(variables)
  await migrateLegacyRuntimeVariables()
}

function withVariable(
  current: readonly ScopedVariable[],
  scope: VariableScope,
  key: string,
  value: string,
): ScopedVariable[] {
  const next = current.filter((entry) => !(entry.scope === scope && entry.key === key))
  next.push({ scope, key, value })
  return next
}

export async function saveScopedVariable(scope: VariableScope, key: string, value: string): Promise<void> {
  const before = cache
  publish(withVariable(before, scope, key, value))
  try {
    const saved = await workspaceApi.setVariable(scope, key, value)
    publish(withVariable(cache, scope, key, saved.value))
  } catch (error) {
    publish(before)
    throw error
  }
}

/**
 * Edits a variable in place, renaming it when the key changed.
 *
 * The API has no rename, so a rename is "write the new key, then delete the old one". The new key
 * is written first: if the delete then fails, the user ends up with both names rather than with
 * neither, and the error tells them so.
 */
export async function updateScopedVariable(scope: VariableScope, oldKey: string, newKey: string, value: string): Promise<void> {
  if (newKey !== oldKey && cache.some((entry) => entry.scope === scope && entry.key === newKey)) {
    throw new Error(`"${newKey}" already exists in this scope.`)
  }
  const before = cache
  publish(withVariable(before.filter((entry) => !(entry.scope === scope && entry.key === oldKey)), scope, newKey, value))
  try {
    const saved = await workspaceApi.updateVariable(scope, oldKey, {
      ...(newKey !== oldKey ? { key: newKey } : {}),
      value,
    })
    publish(withVariable(cache, scope, saved.key, saved.value))
  } catch (error) {
    publish(before)
    throw error
  }
}

/**
 * Creates a variable, refusing a name that already exists in that scope.
 *
 * The API's `PUT` is an upsert, so without this check "Add" would silently overwrite an existing
 * value, which for a global one is a teammate's value. This only checks the local mirror; see
 * docs/variables-add-backend.md for closing the race on the server.
 */
export async function addScopedVariable(scope: VariableScope, key: string, value: string): Promise<void> {
  if (cache.some((entry) => entry.scope === scope && entry.key === key)) {
    throw new Error(`"${key}" already exists in this scope.`)
  }
  const before = cache
  publish(withVariable(before, scope, key, value))
  try {
    const saved = await workspaceApi.createVariable(scope, key, value)
    publish(withVariable(cache, scope, saved.key, saved.value))
  } catch (error) {
    publish(before)
    throw error
  }
}

export async function removeScopedVariable(scope: VariableScope, key: string): Promise<void> {
  const before = cache
  publish(before.filter((entry) => !(entry.scope === scope && entry.key === key)))
  try {
    await workspaceApi.deleteVariable(scope, key)
  } catch (error) {
    publish(before)
    throw error
  }
}

/**
 * Moves anything left in the old per-tab store up to user scope, once.
 *
 * Done after the first successful load so a failed fetch cannot destroy the only copy. Each value
 * is written individually and the key is cleared only if every write succeeded, because a partial
 * migration that still wiped the source would lose the rest.
 */
export async function migrateLegacyRuntimeVariables(): Promise<void> {
  let legacy: Record<string, string>
  try {
    const raw = window.sessionStorage.getItem(LEGACY_STORAGE_KEY)
    if (!raw) return
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
    legacy = Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    )
  } catch {
    return
  }

  const names = Object.keys(legacy)
  if (names.length === 0) {
    window.sessionStorage.removeItem(LEGACY_STORAGE_KEY)
    return
  }
  try {
    for (const name of names) {
      // A value already at user scope was saved deliberately after the upgrade; the tab's leftover
      // copy is the older one, so it must not overwrite it.
      if (cache.some((entry) => entry.scope === 'user' && entry.key === name)) continue
      await saveScopedVariable('user', name, legacy[name]!)
    }
    window.sessionStorage.removeItem(LEGACY_STORAGE_KEY)
  } catch {
    // Left in place to be retried on the next load rather than dropped.
  }
}

/** Test-only: drops the snapshot so a fresh load starts from nothing. */
export function resetScopedVariables(): void {
  cacheGeneration += 1
  cache = EMPTY
  for (const listener of listeners) listener()
}
