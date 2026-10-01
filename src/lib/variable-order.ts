// How the Variables menu orders the names inside each scope group, and the per-user preference
// that remembers it.
//
// Decisions:
// - One sort applies to every group, because switching it per group is a setting nobody would
//   find. Manual order, on the other hand, is per group (and per environment): the same name can
//   sit in several groups, and an order chosen for one environment means nothing in another.
// - A manual list stores only names. Names it does not know about (captured after the order was
//   saved, or defined by a teammate) are appended in key order rather than hidden, and names that
//   no longer exist are ignored rather than eagerly pruned, so a variable that comes back (an
//   environment switched back, a delete undone) returns to where the user put it.
// - Moving a row while a column sort is active switches to manual order, starting from what the
//   user is currently looking at. Anything else would make the row jump somewhere unexpected.

import type { VariableOrigin } from '@/lib/variable-scopes'

export type VariableSortField = 'key' | 'value'
export type SortDirection = 'asc' | 'desc'
export interface VariableSort {
  field: VariableSortField
  direction: SortDirection
}

export interface VariableOrderPreferences {
  version: 1
  /** `null` means manual order. */
  sort: VariableSort | null
  manual: {
    user: string[]
    global: string[]
    /** Keyed by environment id. */
    environments: Record<string, string[]>
  }
  updatedAt?: string
}

export type MoveTarget = 'top' | 'up' | 'down' | 'bottom' | { before: string } | { after: string }

export const DEFAULT_VARIABLE_ORDER: VariableOrderPreferences = Object.freeze({
  version: 1,
  sort: { field: 'key', direction: 'asc' },
  manual: Object.freeze({ user: [], global: [], environments: Object.freeze({}) }),
}) as VariableOrderPreferences

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

function byKey(a: string, b: string): number {
  return collator.compare(a, b) || (a < b ? -1 : a > b ? 1 : 0)
}

/** Orders `names` for display. `valueOf` is only consulted for a value sort. */
export function orderVariableNames(
  names: readonly string[],
  valueOf: (name: string) => string,
  sort: VariableSort | null,
  manual: readonly string[] = [],
): string[] {
  if (sort) {
    const sign = sort.direction === 'asc' ? 1 : -1
    return [...names].sort((a, b) => sign * (sort.field === 'value' ? collator.compare(valueOf(a), valueOf(b)) || byKey(a, b) : byKey(a, b)))
  }
  const present = new Set(names)
  const placed = new Set<string>()
  const ordered: string[] = []
  for (const name of manual) {
    if (present.has(name) && !placed.has(name)) {
      ordered.push(name)
      placed.add(name)
    }
  }
  return [...ordered, ...names.filter((name) => !placed.has(name)).sort(byKey)]
}

/**
 * Moves `name` within `visible` (the order on screen) and returns the new manual list.
 *
 * Names in the stored list that are not visible right now are kept, at the end, so they keep
 * their relative order if they reappear.
 */
export function moveVariableName(
  visible: readonly string[],
  stored: readonly string[],
  name: string,
  target: MoveTarget,
): string[] {
  const from = visible.indexOf(name)
  if (from === -1) return [...stored]
  const rest = visible.filter((entry) => entry !== name)
  let to: number
  if (target === 'top') to = 0
  else if (target === 'bottom') to = rest.length
  else if (target === 'up') to = Math.max(0, from - 1)
  else if (target === 'down') to = Math.min(rest.length, from + 1)
  else if ('before' in target) to = target.before === name ? from : rest.indexOf(target.before)
  else to = target.after === name ? from : (rest.includes(target.after) ? rest.indexOf(target.after) + 1 : -1)
  if (to < 0) to = from
  const next = [...rest.slice(0, to), name, ...rest.slice(to)]
  const shown = new Set(visible)
  return [...next, ...stored.filter((entry) => !shown.has(entry))]
}

/** Keeps a renamed variable where the user had put it. */
export function renameInOrder(list: readonly string[], oldName: string, newName: string): string[] {
  if (oldName === newName) return [...list]
  return list.filter((entry) => entry !== newName).map((entry) => entry === oldName ? newName : entry)
}

export function manualListFor(
  preferences: VariableOrderPreferences,
  origin: VariableOrigin,
  environmentId: string | null,
): string[] {
  if (origin === 'environment') return environmentId ? preferences.manual.environments[environmentId] ?? [] : []
  return preferences.manual[origin]
}

export function withManualList(
  preferences: VariableOrderPreferences,
  origin: VariableOrigin,
  environmentId: string | null,
  list: string[],
): VariableOrderPreferences {
  if (origin === 'environment') {
    if (!environmentId) return preferences
    return { ...preferences, manual: { ...preferences.manual, environments: { ...preferences.manual.environments, [environmentId]: list } } }
  }
  return { ...preferences, manual: { ...preferences.manual, [origin]: list } }
}

/**
 * Header click cycle: ascending, descending, then back to manual order.
 * Clicking the other column always starts it ascending.
 */
export function nextSort(current: VariableSort | null, field: VariableSortField): VariableSort | null {
  if (!current || current.field !== field) return { field, direction: 'asc' }
  if (current.direction === 'asc') return { field, direction: 'desc' }
  return null
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

/** Accepts anything (storage, the API) and returns a valid preference, falling back per field. */
export function normalizeVariableOrder(raw: unknown): VariableOrderPreferences {
  if (!raw || typeof raw !== 'object') return DEFAULT_VARIABLE_ORDER
  const input = raw as Record<string, unknown>
  let sort: VariableSort | null = DEFAULT_VARIABLE_ORDER.sort
  if (input.sort === null) sort = null
  else if (input.sort && typeof input.sort === 'object') {
    const { field, direction } = input.sort as Record<string, unknown>
    if ((field === 'key' || field === 'value') && (direction === 'asc' || direction === 'desc')) sort = { field, direction }
  }
  const manualInput = (input.manual && typeof input.manual === 'object' ? input.manual : {}) as Record<string, unknown>
  const environmentsInput = (manualInput.environments && typeof manualInput.environments === 'object' && !Array.isArray(manualInput.environments)
    ? manualInput.environments
    : {}) as Record<string, unknown>
  const environments: Record<string, string[]> = {}
  for (const [id, list] of Object.entries(environmentsInput)) environments[id] = stringList(list)
  return {
    version: 1,
    sort,
    manual: { user: stringList(manualInput.user), global: stringList(manualInput.global), environments },
    ...(typeof input.updatedAt === 'string' ? { updatedAt: input.updatedAt } : {}),
  }
}
