// Sync rules: "keep this variable up to date from this request's responses".
//
// Capturing a value once covers the case where a token is fetched and then reused. It does not
// cover a value that the server *advances* on every call - a game's `mathState` comes back changed
// from each spin, and a captured copy is stale the moment it is used. A sync rule re-runs the same
// extraction automatically whenever that request produces a new response.
//
// Decisions:
// - A rule is bound to the request it was created on, not applied globally. A path like
//   `gameData.mathState` does not exist in an unrelated response, so a global rule would either
//   error constantly or wipe a good value with nothing.
// - Rules live in `sessionStorage` next to the runtime variables they write. A rule is worthless
//   without its variable, so outliving it would only resurrect a value the user expected gone.
// - Rules are keyed by request *and* variable name, so re-saving the same variable on the same
//   request updates the rule in place instead of accumulating duplicates.

import type { ExtractionResult } from '@/lib/response-extraction'
import type { ExecutionSuccess } from '@/lib/request-runner'

const STORAGE_KEY = 'play-next-api-workspace.sync-rules.v1'

export interface SyncRule {
  /** The `resourceKey` of the request whose responses feed this rule. */
  requestKey: string
  name: string
  path: string
}

const EMPTY: readonly SyncRule[] = Object.freeze([])

let cache: readonly SyncRule[] | null = null
const listeners = new Set<() => void>()

function isRule(value: unknown): value is SyncRule {
  if (!value || typeof value !== 'object') return false
  const rule = value as Record<string, unknown>
  return typeof rule.requestKey === 'string' && typeof rule.name === 'string' && typeof rule.path === 'string'
}

function read(): readonly SyncRule[] {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return EMPTY
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return EMPTY
    return Object.freeze(parsed.filter(isRule))
  } catch {
    return EMPTY
  }
}

function write(next: readonly SyncRule[]) {
  cache = Object.freeze([...next])
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
  } catch {
    // The in-memory cache still serves this tab; a failed persist must not break sending.
  }
  for (const listener of listeners) listener()
}

/** Stable snapshot suitable for `useSyncExternalStore`. */
export function getSyncRules(): readonly SyncRule[] {
  cache ??= read()
  return cache
}

export function subscribeSyncRules(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function rulesForRequest(requestKey: string): readonly SyncRule[] {
  return getSyncRules().filter((rule) => rule.requestKey === requestKey)
}

export function findSyncRule(requestKey: string, name: string): SyncRule | null {
  return getSyncRules().find((rule) => rule.requestKey === requestKey && rule.name === name) ?? null
}

export function setSyncRule(rule: SyncRule): void {
  const others = getSyncRules().filter((entry) => !(entry.requestKey === rule.requestKey && entry.name === rule.name))
  write([...others, rule])
}

export function removeSyncRule(requestKey: string, name: string): void {
  const current = getSyncRules()
  const next = current.filter((rule) => !(rule.requestKey === requestKey && rule.name === name))
  if (next.length === current.length) return
  write(next)
}

export function clearSyncRules(): void {
  write(EMPTY)
}

/** Test-only: drops the cached snapshot so a fresh read happens. */
export function resetSyncRulesCache(): void {
  cache = null
}

export interface SyncOutcome {
  name: string
  path: string
  ok: boolean
  /** Present when the extraction failed, so the UI can say why rather than showing a stale value as current. */
  error?: string
}

/**
 * Re-runs every rule bound to this request against its new response.
 *
 * A failing rule leaves the previous value in place rather than deleting it. Both options are
 * wrong in some way - a stale value can be used unknowingly, a missing one breaks the next send -
 * but a stale value paired with a visible error is recoverable, whereas silently discarding a
 * working value is not. The outcome is returned so the caller can surface the failure.
 */
export function applySyncRules(
  requestKey: string,
  response: ExecutionSuccess,
  extract: (path: string, response: ExecutionSuccess) => ExtractionResult,
  store: (name: string, value: string) => void,
): SyncOutcome[] {
  return rulesForRequest(requestKey).map((rule) => {
    const extracted = extract(rule.path, response)
    if (!extracted.ok) return { name: rule.name, path: rule.path, ok: false, error: extracted.error }
    store(rule.name, extracted.value)
    return { name: rule.name, path: rule.path, ok: true }
  })
}
