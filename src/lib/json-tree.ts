import { childPath, indexPath } from '@/lib/json-path'

/**
 * Turns a parsed JSON body into the flat list of rows the response tree renders.
 *
 * The list is built from the expansion state rather than from the whole document, so a collapsed
 * container costs nothing: work is proportional to what is actually on screen, not to the size of
 * the response. That is what makes collapsing worth having on a large body in the first place.
 */

export type JsonKind = 'object' | 'array' | 'primitive'

export interface JsonRow {
  /** Addressable path, or null when the key cannot be expressed (see `childPath`). */
  path: string | null
  /** Identity for React and for the expansion set; always present, unlike `path`. */
  id: string
  depth: number
  /** The key or index as displayed; null at the root. */
  label: string | null
  kind: JsonKind
  value: unknown
  /** Entries in this container; 0 for a primitive. */
  childCount: number
  expanded: boolean
  /**
   * Set on the synthetic row that stands in for the children a capped container is not showing.
   */
  hiddenCount?: number
}

/**
 * A single container can hold far more entries than is useful to put on screen at once, and one
 * click should not be able to create a hundred thousand rows. Capped containers get a row offering
 * the rest, so nothing is hidden without saying so.
 */
export const CHILDREN_PER_CONTAINER = 200

/**
 * Expanding everything is only offered while the result stays manageable. Past this, expand-all is
 * refused with a reason rather than freezing the tab; branches can still be opened individually.
 */
export const EXPAND_ALL_BUDGET = 5000

export function kindOf(value: unknown): JsonKind {
  if (Array.isArray(value)) return 'array'
  if (value !== null && typeof value === 'object') return 'object'
  return 'primitive'
}

function entriesOf(value: unknown): { label: string; id: string; value: unknown }[] {
  if (Array.isArray(value)) {
    return value.map((entry, index) => ({ label: String(index), id: String(index), value: entry }))
  }
  return Object.entries(value as Record<string, unknown>).map(([key, entry]) => ({
    label: key,
    id: key,
    value: entry,
  }))
}

/** Counts every node, stopping once `limit` is passed so a huge body is not fully walked. */
export function countNodes(value: unknown, limit = Number.POSITIVE_INFINITY): number {
  let seen = 0
  const walk = (node: unknown) => {
    if (seen > limit) return
    seen += 1
    const kind = kindOf(node)
    if (kind === 'array') for (const entry of node as unknown[]) walk(entry)
    else if (kind === 'object') for (const entry of Object.values(node as Record<string, unknown>)) walk(entry)
  }
  walk(value)
  return seen
}

/**
 * Every container path, for expand-all. Returns null when the tree is larger than `budget`, which
 * the caller reports rather than attempting the expansion.
 */
export function allContainerIds(value: unknown, budget = EXPAND_ALL_BUDGET): Set<string> | null {
  if (countNodes(value, budget) > budget) return null
  const ids = new Set<string>()
  const walk = (node: unknown, id: string) => {
    const kind = kindOf(node)
    if (kind === 'primitive') return
    ids.add(id)
    if (kind === 'array') {
      ;(node as unknown[]).forEach((entry, index) => walk(entry, `${id}\u0000${index}`))
      return
    }
    for (const [key, entry] of Object.entries(node as Record<string, unknown>)) walk(entry, `${id}\u0000${key}`)
  }
  walk(value, '')
  return ids
}

export interface BuildOptions {
  expanded: Set<string>
  /** Container ids whose child cap the user has lifted. */
  revealed?: Set<string>
  childrenPerContainer?: number
}

export function buildRows(root: unknown, options: BuildOptions): JsonRow[] {
  const { expanded, revealed, childrenPerContainer = CHILDREN_PER_CONTAINER } = options
  const rows: JsonRow[] = []

  const visit = (value: unknown, label: string | null, path: string | null, id: string, depth: number) => {
    const kind = kindOf(value)
    const children = kind === 'primitive' ? [] : entriesOf(value)
    const isExpanded = kind !== 'primitive' && expanded.has(id)

    rows.push({ path, id, depth, label, kind, value, childCount: children.length, expanded: isExpanded })
    if (!isExpanded) return

    const cap = revealed?.has(id) ? children.length : childrenPerContainer
    const shown = children.slice(0, cap)

    shown.forEach((child, index) => {
      const childId = `${id}\u0000${child.id}`
      // A child of an unaddressable parent is itself unaddressable: there is no prefix to build on.
      const nextPath =
        path === null ? null : kind === 'array' ? indexPath(path, index) : childPath(path, child.label)
      visit(child.value, child.label, nextPath, childId, depth + 1)
    })

    if (children.length > shown.length) {
      rows.push({
        path: null,
        id: `${id}\u0000\u0000more`,
        depth: depth + 1,
        label: null,
        kind: 'primitive',
        value: null,
        childCount: 0,
        expanded: false,
        hiddenCount: children.length - shown.length,
      })
    }
  }

  visit(root, null, '', '', 0)
  return rows
}

/**
 * What is open when a response first appears.
 *
 * Today the body is shown fully pretty-printed, so collapsing by default would take away
 * information the user currently gets for free. Everything is therefore expanded while that stays
 * affordable, and only the root is opened past that point — the case where a wall of text was
 * unreadable anyway, which is what prompted collapsing.
 */
export function defaultExpanded(value: unknown, budget = EXPAND_ALL_BUDGET): Set<string> {
  return allContainerIds(value, budget) ?? new Set([''])
}

/** A one-line summary shown on a collapsed container, so it is not an opaque `{…}`. */
export function summarise(row: JsonRow): string {
  if (row.kind === 'array') return row.childCount === 1 ? '1 item' : `${row.childCount} items`
  return row.childCount === 1 ? '1 key' : `${row.childCount} keys`
}

export function formatPrimitive(value: unknown): string {
  if (typeof value === 'string') return JSON.stringify(value)
  return String(value)
}

export function primitiveClass(value: unknown): string {
  if (value === null) return 'json-null'
  switch (typeof value) {
    case 'string':
      return 'json-string'
    case 'number':
      return 'json-number'
    case 'boolean':
      return 'json-boolean'
    default:
      return 'json-value'
  }
}
