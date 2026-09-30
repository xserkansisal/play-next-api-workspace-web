// Persistence for which tree nodes the user has collapsed.
//
// Decisions:
// - `localStorage`, not `sessionStorage`: the point is that the tree still looks the way the user
//   left it after closing the browser. Runtime variables use `sessionStorage` because they are
//   short-lived credentials; a collapsed folder is durable UI preference, not a secret.
// - Stored per browser, not per user or per workspace. Collections are team-shared, but how *this*
//   person likes their sidebar is not, and writing it to the API would make one user's collapsing
//   rearrange everyone else's tree.
// - Stored as the set of *collapsed* ids, matching the in-memory model, so a folder created later
//   or arriving over SSE defaults to expanded instead of inheriting a stale collapsed state.
// - Reads never throw. `localStorage` is unavailable in some privacy modes and can be over quota;
//   losing the expansion preference is acceptable, breaking the sidebar is not.

const STORAGE_KEY = 'play-next-api-workspace.collapsed-tree-nodes.v1'

/** Guards against one runaway workspace filling the origin's storage quota. */
const MAX_STORED_IDS = 5000

export function loadCollapsedIds(): ReadonlySet<string> {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return new Set()
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.filter((id): id is string => typeof id === 'string'))
  } catch {
    return new Set()
  }
}

export function saveCollapsedIds(ids: ReadonlySet<string>): void {
  try {
    if (ids.size === 0) {
      window.localStorage.removeItem(STORAGE_KEY)
      return
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids].slice(0, MAX_STORED_IDS)))
  } catch {
    // Storage full or unavailable; the tree still works, it just will not be remembered.
  }
}

/**
 * Drops ids of nodes that no longer exist, so deleting and recreating folders cannot grow the
 * stored set without bound.
 *
 * Returns the original set unchanged when `knownIds` is empty. An empty tree is indistinguishable
 * from a tree that has not loaded yet, and pruning during that first render would erase the user's
 * saved state before the collections ever arrive.
 */
export function pruneCollapsedIds(
  collapsedIds: ReadonlySet<string>,
  knownIds: readonly string[],
): ReadonlySet<string> {
  if (knownIds.length === 0 || collapsedIds.size === 0) return collapsedIds
  const known = new Set(knownIds)
  const kept = [...collapsedIds].filter((id) => known.has(id))
  // Preserve identity when nothing changed, so this cannot cause a render loop.
  return kept.length === collapsedIds.size ? collapsedIds : new Set(kept)
}
