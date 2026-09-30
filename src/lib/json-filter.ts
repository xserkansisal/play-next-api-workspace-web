import { kindOf } from '@/lib/json-tree'

/**
 * Narrows a JSON response body to the parts that match what was typed.
 *
 * Collapsing made a large body navigable; it did not make a named field findable. The browser's own
 * find does not help either, because a collapsed branch is not in the DOM to be found.
 *
 * The result is a set of node ids rather than a pruned copy of the document. A pruned copy would
 * renumber arrays — the fifth entry would become the first — and every path shown next to a row
 * would then address a different value in the real response. Those paths are the whole point of the
 * tree, so the document is left alone and the rows are filtered on the way out.
 */

export interface FilterResult {
  /** Rows to render. Ancestors of a match are included, or the match would have nothing to hang from. */
  visible: Set<string>
  /** Ids that matched in their own right, for highlighting. */
  matches: Set<string>
  /** Containers to force open, so a match is not hidden behind a branch the user had collapsed. */
  expand: Set<string>
  matchCount: number
}

/**
 * Matching is case-insensitive substring, against the key and against the value as it reads rather
 * than as it is encoded: typing `100` finds the number 100 and the string "100", and typing `null`
 * finds a null. Quoting and escaping are an artefact of JSON, not something to search for.
 */
function matchText(label: string | null, value: unknown, needle: string): boolean {
  if (label !== null && label.toLowerCase().includes(needle)) return true
  if (kindOf(value) !== 'primitive') return false
  return String(value).toLowerCase().includes(needle)
}

/**
 * Returns null for a blank query, which callers read as "no filter" — distinct from a query that
 * matched nothing, where an empty tree is the honest answer.
 */
export function filterJson(root: unknown, query: string): FilterResult | null {
  const needle = query.trim().toLowerCase()
  if (needle === '') return null

  const visible = new Set<string>()
  const matches = new Set<string>()
  const expand = new Set<string>()
  let matchCount = 0

  const keepSubtree = (value: unknown, id: string) => {
    visible.add(id)
    if (kindOf(value) === 'primitive') return
    for (const child of entriesOf(value)) keepSubtree(child.value, `${id}\u0000${child.id}`)
  }

  /**
   * Returns whether this subtree is worth showing. A matching node brings its whole subtree with
   * it: finding `mathState` and then being shown an empty `mathState` would be useless, and it is
   * also what makes copying the filtered part meaningful.
   */
  const walk = (value: unknown, label: string | null, id: string, ancestors: string[]): boolean => {
    const matched = matchText(label, value, needle)
    if (matched) {
      matches.add(id)
      matchCount += 1
      keepSubtree(value, id)
      for (const ancestor of ancestors) {
        visible.add(ancestor)
        expand.add(ancestor)
      }
      visible.add(id)
    }

    const kind = kindOf(value)
    if (kind === 'primitive') return matched

    // Descending even into a matched container would double-count its descendants, and its subtree
    // is already kept whole.
    if (matched) return true

    const nextAncestors = [...ancestors, id]
    let kept = false
    for (const child of entriesOf(value)) {
      if (walk(child.value, child.label, `${id}\u0000${child.id}`, nextAncestors)) kept = true
    }
    if (kept) {
      visible.add(id)
      expand.add(id)
    }
    return kept
  }

  walk(root, null, '', [])
  // The root is always present: it is the container the rows hang from, and with no match at all it
  // renders as an empty body rather than as nothing.
  visible.add('')

  return { visible, matches, expand, matchCount }
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

/**
 * Rebuilds a JSON value from the visible ids, for copying the filtered part.
 *
 * Arrays here *do* lose their original indices, unlike the tree: a copied fragment is a document in
 * its own right, and leaving holes would make it invalid JSON. The tree beside it still shows the
 * true paths, so nothing is lost — but this is why the two are built separately rather than the
 * tree being rendered from this.
 */
export function extractVisible(root: unknown, visible: Set<string>): unknown {
  const build = (value: unknown, id: string): unknown => {
    const kind = kindOf(value)
    if (kind === 'primitive') return value

    if (kind === 'array') {
      const kept: unknown[] = []
      ;(value as unknown[]).forEach((entry, index) => {
        const childId = `${id}\u0000${index}`
        if (visible.has(childId)) kept.push(build(entry, childId))
      })
      return kept
    }

    const kept: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      const childId = `${id}\u0000${key}`
      if (visible.has(childId)) kept[key] = build(entry, childId)
    }
    return kept
  }

  return build(root, '')
}
