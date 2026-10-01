import type { AuthCredentials, CollectionResource, FolderResource, RequestAuth, WorkspaceItem } from '@/lib/workspace-types'

/**
 * One link in the inheritance chain above a request, nearest first: the request's immediate
 * parent folder (if any), each enclosing folder up to the root, and finally the collection
 * itself. Used both to resolve the effective auth and to explain *where* it came from.
 */
export interface AuthAncestor {
  kind: 'folder' | 'collection'
  id: string
  name: string
  auth: AuthCredentials | null
}

/**
 * Where a resolved auth value came from: the request's own setting, a specific ancestor, or
 * `'default'` when nothing in the chain (including the collection) has an auth configured.
 */
export type AuthSource = 'own' | AuthAncestor | 'default'

function findFolderPath(items: WorkspaceItem[], parentId: string | null): FolderResource[] {
  if (parentId === null) return []

  function search(nodes: WorkspaceItem[], path: FolderResource[]): FolderResource[] | null {
    for (const node of nodes) {
      if (node.type !== 'folder') continue
      const nextPath = [...path, node]
      if (node.id === parentId) return nextPath
      const found = search(node.items, nextPath)
      if (found) return found
    }
    return null
  }

  const path = search(items, [])
  // Nearest-first: the path above is built root-to-target, so it's reversed before use.
  return path ? [...path].reverse() : []
}

/**
 * Builds the inheritance chain above a given parent folder (or the collection root), nearest
 * ancestor first. Pass the request/folder's own `parentId`; the chain never includes the item
 * itself.
 */
export function buildAuthAncestry(collection: CollectionResource, parentId: string | null): AuthAncestor[] {
  const folderPath = findFolderPath(collection.items, parentId)
  const folderAncestors: AuthAncestor[] = folderPath.map((folder) => ({
    kind: 'folder',
    id: folder.id,
    name: folder.name,
    auth: folder.auth ?? null,
  }))
  return [
    ...folderAncestors,
    { kind: 'collection', id: collection.id, name: collection.name, auth: collection.auth ?? null },
  ]
}

/**
 * Resolves a request's own auth setting against its ancestry. A setting other than `inherit`
 * always wins outright; `inherit` takes the nearest ancestor that has something configured, and
 * falls back to `none` when nothing above it does either.
 */
export function resolveEffectiveAuth(
  ownAuth: RequestAuth,
  ancestry: readonly AuthAncestor[],
): { auth: AuthCredentials; source: AuthSource } {
  if (ownAuth.type !== 'inherit') return { auth: ownAuth, source: 'own' }
  for (const ancestor of ancestry) {
    if (ancestor.auth) return { auth: ancestor.auth, source: ancestor }
  }
  return { auth: { type: 'none' }, source: 'default' }
}

/** A short, human-readable description of an `AuthSource`, for display next to a resolved value. */
export function describeAuthSource(source: AuthSource): string {
  if (source === 'own') return 'this request'
  if (source === 'default') return 'no ancestor has authentication configured'
  return `${source.kind === 'collection' ? 'collection' : 'folder'} "${source.name}"`
}
