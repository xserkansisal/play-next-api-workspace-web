// Runtime variables: values captured out of a response and reused in later
// requests via the existing `{{name}}` substitution.
//
// Decisions (reported to the user):
// - These live in `sessionStorage`, per browser tab, and are never sent to
//   the API. Collections and environments are shared by the whole team, so
//   writing a captured value (typically a short-lived token tied to one
//   person's sign-in) into a shared environment would silently change what
//   everyone else sends. Keeping them local also means no API change.
// - They take precedence over environment variables of the same name, so a
//   captured value overrides a stale placeholder without editing the
//   environment.
// - They are cleared when the tab closes. They are a chaining aid, not
//   durable configuration.

const STORAGE_KEY = 'play-next-api-workspace.runtime-variables.v1'

export type RuntimeVariables = Readonly<Record<string, string>>

const EMPTY: RuntimeVariables = Object.freeze({})

let cache: RuntimeVariables | null = null
const listeners = new Set<() => void>()

function read(): RuntimeVariables {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY)
    if (!raw) return EMPTY
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return EMPTY
    const entries = Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    return Object.freeze(Object.fromEntries(entries))
  } catch {
    return EMPTY
  }
}

function write(next: RuntimeVariables) {
  cache = Object.freeze({ ...next })
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(cache))
  } catch {
    // Storage can be unavailable (private mode, quota). The in-memory cache
    // still serves this tab, so a failed persist must not break sending.
  }
  for (const listener of listeners) listener()
}

/** Stable snapshot suitable for `useSyncExternalStore`. */
export function getRuntimeVariables(): RuntimeVariables {
  cache ??= read()
  return cache
}

export function subscribeRuntimeVariables(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export type NameValidation = { ok: true; name: string } | { ok: false; error: string }

/**
 * Variable names are referenced as `{{name}}`, so anything that would break
 * that reference (empty, braces, whitespace) has to be rejected at entry
 * rather than producing a variable that can never be used.
 */
export function validateVariableName(rawName: string): NameValidation {
  const name = rawName.trim()
  if (!name) return { ok: false, error: 'Enter a name for the variable.' }
  if (/[{}]/.test(name)) return { ok: false, error: 'A variable name cannot contain { or }.' }
  if (/\s/.test(name)) return { ok: false, error: 'A variable name cannot contain spaces.' }
  return { ok: true, name }
}

export function setRuntimeVariable(name: string, value: string): void {
  write({ ...getRuntimeVariables(), [name]: value })
}

export function removeRuntimeVariable(name: string): void {
  const current = getRuntimeVariables()
  if (!Object.prototype.hasOwnProperty.call(current, name)) return
  const next = { ...current }
  delete next[name]
  write(next)
}

export function clearRuntimeVariables(): void {
  write(EMPTY)
}

/** Test-only: drops the cached snapshot so a fresh read happens. */
export function resetRuntimeVariablesCache(): void {
  cache = null
}
