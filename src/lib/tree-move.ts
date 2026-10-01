import type { CollectionResource, WorkspaceItem } from '@/lib/workspace-types'
import { nameKey } from '@/lib/workspace-ui'

/**
 * Moving a node in the sidebar is a *reparent*, never a reorder: the tree renders in a derived
 * order (folders first, then requests, each alphabetical) and the model stores no sibling index,
 * so dropping between two rows has nothing to persist. Every drop therefore resolves to "this
 * subtree now belongs to that collection root or that folder".
 */

export interface MoveSource {
  collectionId: string
  itemId: string
}

export type MoveTarget =
  | { kind: 'collection'; collectionId: string }
  | { kind: 'folder'; collectionId: string; itemId: string }

export type MoveRejection =
  | 'missing-source'
  | 'missing-target'
  | 'into-self'
  | 'into-descendant'
  | 'same-parent'
  | 'name-taken'

export type MoveCheck =
  | { ok: true }
  | { ok: false; reason: MoveRejection; message: string }

interface Located {
  item: WorkspaceItem
  parentId: string | null
}

function locate(items: WorkspaceItem[], itemId: string, parentId: string | null): Located | null {
  for (const item of items) {
    if (item.id === itemId) return { item, parentId }
    if (item.type === 'folder') {
      const found = locate(item.items, itemId, item.id)
      if (found) return found
    }
  }
  return null
}

function findSource(collections: CollectionResource[], source: MoveSource): Located | null {
  const collection = collections.find(({ id }) => id === source.collectionId)
  if (!collection) return null
  return locate(collection.items, source.itemId, null)
}

/** True when `id` is the node itself or anywhere beneath it - the cycle guard for folder drops. */
function subtreeContains(item: WorkspaceItem, id: string): boolean {
  if (item.id === id) return true
  return item.type === 'folder' && item.items.some((child) => subtreeContains(child, id))
}

/** The sibling list a drop would land in, or null when the target does not exist. */
function destinationChildren(collections: CollectionResource[], target: MoveTarget): WorkspaceItem[] | null {
  const collection = collections.find(({ id }) => id === target.collectionId)
  if (!collection) return null
  if (target.kind === 'collection') return collection.items
  const found = locate(collection.items, target.itemId, null)
  if (!found || found.item.type !== 'folder') return null
  return found.item.items
}

export function checkMove(
  collections: CollectionResource[],
  source: MoveSource,
  target: MoveTarget,
): MoveCheck {
  const found = findSource(collections, source)
  if (!found) return { ok: false, reason: 'missing-source', message: 'That item no longer exists.' }

  const siblings = destinationChildren(collections, target)
  if (!siblings) return { ok: false, reason: 'missing-target', message: 'That destination no longer exists.' }

  if (target.kind === 'folder') {
    if (target.itemId === source.itemId) {
      return { ok: false, reason: 'into-self', message: 'A folder cannot be moved into itself.' }
    }
    // Reparenting a folder under its own descendant would detach the whole subtree from the root.
    if (subtreeContains(found.item, target.itemId)) {
      return { ok: false, reason: 'into-descendant', message: 'A folder cannot be moved into one of its own subfolders.' }
    }
  }

  const destinationParentId = target.kind === 'folder' ? target.itemId : null
  if (found.parentId === destinationParentId && source.collectionId === target.collectionId) {
    return { ok: false, reason: 'same-parent', message: 'It is already there.' }
  }

  // Only folders collide: the API requires sibling *folder* names to be unique case-insensitively,
  // while sibling requests may repeat a name.
  if (found.item.type === 'folder') {
    const key = nameKey(found.item.name)
    const clash = siblings.some((sibling) => sibling.type === 'folder' && sibling.id !== found.item.id && nameKey(sibling.name) === key)
    if (clash) {
      return { ok: false, reason: 'name-taken', message: `A folder named "${found.item.name}" is already there.` }
    }
  }

  return { ok: true }
}

/** Rewrites a moved subtree so every descendant carries its new collection and parent. */
function reassign(item: WorkspaceItem, collectionId: string, parentId: string | null): WorkspaceItem {
  if (item.type === 'folder') {
    return {
      ...item,
      collectionId,
      parentId,
      items: item.items.map((child) => reassign(child, collectionId, item.id)),
    }
  }
  return { ...item, collectionId, parentId }
}

function removeItem(items: WorkspaceItem[], itemId: string): WorkspaceItem[] {
  return items
    .filter((item) => item.id !== itemId)
    .map((item) => (item.type === 'folder' ? { ...item, items: removeItem(item.items, itemId) } : item))
}

function insertInto(items: WorkspaceItem[], folderId: string, node: WorkspaceItem): WorkspaceItem[] {
  return items.map((item) => {
    if (item.type !== 'folder') return item
    if (item.id === folderId) return { ...item, items: [...item.items, node] }
    return { ...item, items: insertInto(item.items, folderId, node) }
  })
}

/**
 * The optimistic local result of a move. Returns the input untouched when the move is not valid,
 * so a caller that skips `checkMove` cannot corrupt the tree.
 */
export function applyMove(
  collections: CollectionResource[],
  source: MoveSource,
  target: MoveTarget,
): CollectionResource[] {
  if (!checkMove(collections, source, target).ok) return collections
  const found = findSource(collections, source)
  if (!found) return collections

  const moved = reassign(found.item, target.collectionId, target.kind === 'folder' ? target.itemId : null)

  return collections.map((collection) => {
    let items = collection.items
    // Removal runs before insertion, so a move within one collection sees the pruned tree and
    // cannot leave the node in both places.
    if (collection.id === source.collectionId) items = removeItem(items, source.itemId)
    if (collection.id === target.collectionId) {
      items = target.kind === 'collection' ? [...items, moved] : insertInto(items, target.itemId, moved)
    }
    return items === collection.items ? collection : { ...collection, items }
  })
}
