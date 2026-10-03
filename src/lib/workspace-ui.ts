import type {
  CollectionResource,
  EnvironmentResource,
  EnvironmentVariable,
  OpenResource,
  RequestMethod,
  RequestResource,
  WorkspaceItem,
} from '@/lib/workspace-types'

/**
 * Short labels for the sidebar, where a row has room for a badge but not a full method name.
 * Only DELETE is abbreviated; the rest already fit, and shortening them would cost more in
 * readability than it saves in width.
 */
const METHOD_LABELS: Record<RequestMethod, string> = {
  GET: 'GET',
  POST: 'POST',
  PUT: 'PUT',
  PATCH: 'PATCH',
  DELETE: 'DEL',
}

export function methodLabel(method: RequestMethod): string {
  return METHOD_LABELS[method] ?? method
}

export function sortByName<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
}

/**
 * Sidebar ordering for the contents of a collection or folder: folders first, then requests, each
 * group alphabetical. Grouping by type keeps the structure of a collection scannable, instead of
 * interleaving containers and leaves in one flat alphabetical run.
 */
export function sortTreeItems(items: WorkspaceItem[]): WorkspaceItem[] {
  return [...items].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
}

// Matches the API's case-insensitive comparison key exactly (name.normalize("NFC").toLowerCase()):
// plain, locale-independent lowercasing, not localeCompare/toLocaleLowerCase. Turkish "İ"/"ı" are
// intentionally NOT folded to "i" here, since the server does not fold them either.
export function nameKey(name: string): string {
  return name.normalize('NFC').toLowerCase()
}

export function findItem(collection: CollectionResource, itemId: string): WorkspaceItem | undefined {
  function visit(items: WorkspaceItem[]): WorkspaceItem | undefined {
    for (const item of items) {
      if (item.id === itemId) return item
      if (item.type === 'folder') {
        const found = visit(item.items)
        if (found) return found
      }
    }
    return undefined
  }
  return visit(collection.items)
}

export function locateOpenResource(
  resource: OpenResource,
  collections: CollectionResource[],
  environments: EnvironmentResource[],
) {
  if (resource.kind === 'environment') {
    const found = environments.find(({ id }) => id === resource.environmentId)
    return found ? { kind: 'environment' as const, resource: found } : null
  }
  const collection = collections.find(({ id }) => id === resource.collectionId)
  if (!collection) return null
  if (resource.kind === 'collection') return { kind: 'collection' as const, resource: collection }
  const item = findItem(collection, resource.itemId)
  if (!item || item.type !== resource.kind) return null
  return item.type === 'request'
    ? { kind: 'request' as const, collectionId: collection.id, resource: item }
    : { kind: 'folder' as const, collectionId: collection.id, resource: item }
}

export function replaceItemInTree(
  items: WorkspaceItem[],
  replacement: WorkspaceItem,
): WorkspaceItem[] {
  return items.map((item) => {
    if (item.id === replacement.id) return replacement
    if (item.type === 'folder') {
      return { ...item, items: replaceItemInTree(item.items, replacement) }
    }
    return item
  })
}

export function setVariable(
  environment: EnvironmentResource,
  index: number,
  value: Partial<EnvironmentVariable>,
): EnvironmentResource {
  return {
    ...environment,
    variables: environment.variables.map((variable, currentIndex) =>
      currentIndex === index ? { ...variable, ...value } : variable,
    ),
  }
}

export function newRequest(id: string, name: string, collectionId: string, parentId: string | null = null): RequestResource {
  return {
    id,
    collectionId,
    parentId,
    type: 'request',
    name,
    description: '',
    method: 'GET',
    url: '',
    queryParams: [],
    headers: [],
    body: null,
    preRequestScript: '',
    postResponseScript: '',
    // New requests default to inherit: they pick up whatever auth is configured on their
    // collection/folder ancestry, and fall back to no auth only if nothing is configured anywhere.
    auth: { type: 'inherit' },
  }
}
