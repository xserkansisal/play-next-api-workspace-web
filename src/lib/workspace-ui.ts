import type {
  CollectionResource,
  EnvironmentResource,
  EnvironmentVariable,
  OpenResource,
  RequestResource,
  WorkspaceItem,
} from '@/lib/workspace-types'

export function sortByName<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
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
    auth: { type: 'none' },
  }
}
