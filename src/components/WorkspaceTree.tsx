import { useCallback, useEffect, useMemo, useState } from 'react'

import { loadCollapsedIds, pruneCollapsedIds, saveCollapsedIds } from '@/lib/tree-expansion-storage'
import { sortByName } from '@/lib/workspace-ui'
import type { CollectionResource, OpenResource, WorkspaceItem } from '@/lib/workspace-types'

interface WorkspaceTreeProps {
  collections: CollectionResource[]
  selected: OpenResource | null
  onSelect: (resource: OpenResource) => void
  onCreateCollection: () => void
  onCreateFolder: () => void
  onCreateRequest: () => void
  onDelete: (resource: OpenResource) => void
  onShowEnvironments: () => void
  onShowTrash: () => void
  onShowHistory: () => void
  collapsed: boolean
}

/**
 * Expansion is tracked as the set of *collapsed* node ids rather than expanded ones, so a node
 * that appears later (a new folder, or one arriving over SSE) defaults to expanded without
 * needing to be registered anywhere first.
 */
type ExpansionState = {
  isCollapsed: (id: string) => boolean
  toggle: (id: string) => void
}

/** Ids of every collection and folder currently in the tree - the nodes that can collapse. */
function collectExpandableIds(collections: CollectionResource[]): string[] {
  const ids: string[] = []
  const walk = (items: WorkspaceItem[]) => {
    for (const item of items) {
      if (item.type === 'folder') {
        ids.push(item.id)
        walk(item.items)
      }
    }
  }
  for (const collection of collections) {
    ids.push(collection.id)
    walk(collection.items)
  }
  return ids
}

function TreeItem({
  collectionId,
  item,
  depth,
  selected,
  onSelect,
  onDelete,
  filter,
  expansion,
}: {
  collectionId: string
  item: WorkspaceItem
  depth: number
  selected: OpenResource | null
  onSelect: (resource: OpenResource) => void
  onDelete: (resource: OpenResource) => void
  filter: string
  expansion: ExpansionState
}) {
  const expanded = !expansion.isCollapsed(item.id)
  const childMatch = item.type === 'folder' && item.items.some((child) => containsMatch(child, filter))
  if (filter && !item.name.toLowerCase().includes(filter) && !childMatch) return null
  const active = selected?.kind === item.type &&
    selected.collectionId === collectionId && selected.itemId === item.id
  const resource: OpenResource = {
    kind: item.type,
    collectionId,
    itemId: item.id,
  }

  return (
    <>
      <div className={`tree-row ${item.type} ${active ? 'selected' : ''}`} style={{ paddingLeft: `${10 + depth * 18}px` }}>
        {item.type === 'folder' ? (
          <button className="tree-chevron" onClick={() => expansion.toggle(item.id)} aria-label={`${expanded ? 'Collapse' : 'Expand'} ${item.name}`}>
            {expanded ? '▾' : '▸'}
          </button>
        ) : <span className="tree-request-mark">●</span>}
        <button className="tree-name" onClick={() => onSelect(resource)} title={item.name}>{item.name}</button>
        <button className="tree-delete" title={`Move ${item.name} to Trash`} aria-label={`Move ${item.name} to Trash`} onClick={() => onDelete(resource)}>×</button>
      </div>
      {item.type === 'folder' && (expanded || !!filter) && sortByName(item.items).map((child) => (
        <TreeItem
          key={child.id}
          collectionId={collectionId}
          item={child}
          depth={depth + 1}
          selected={selected}
          onSelect={onSelect}
          onDelete={onDelete}
          filter={filter}
          expansion={expansion}
        />
      ))}
    </>
  )
}

function containsMatch(item: WorkspaceItem, filter: string): boolean {
  return item.name.toLowerCase().includes(filter) ||
    (item.type === 'folder' && item.items.some((child) => containsMatch(child, filter)))
}

export function WorkspaceTree({
  collections,
  selected,
  onSelect,
  onCreateCollection,
  onCreateFolder,
  onCreateRequest,
  onDelete,
  onShowEnvironments,
  onShowTrash,
  onShowHistory,
  collapsed,
}: WorkspaceTreeProps) {
  const [search, setSearch] = useState('')
  // Restored from storage on first render so the tree opens the way the user left it, rather
  // than fully expanded every time.
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(loadCollapsedIds)
  const filter = search.trim().toLowerCase()
  const sorted = useMemo(() => sortByName(collections), [collections])

  const expandableIds = useMemo(() => collectExpandableIds(sorted), [sorted])
  const toggle = useCallback((id: string) => {
    setCollapsedIds((current) => {
      const next = new Set(current)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }, [])
  const expansion = useMemo<ExpansionState>(() => ({
    isCollapsed: (id: string) => collapsedIds.has(id),
    toggle,
  }), [collapsedIds, toggle])

  // Forget nodes that no longer exist, so deleting and recreating folders cannot grow the stored
  // set forever. Skipped while the tree is empty, which is also how a not-yet-loaded tree looks.
  useEffect(() => {
    setCollapsedIds((current) => pruneCollapsedIds(current, expandableIds))
  }, [expandableIds])

  useEffect(() => {
    saveCollapsedIds(collapsedIds)
  }, [collapsedIds])

  // A search shows matching descendants regardless of collapsed state, so while filtering the
  // buttons would not visibly do anything; disable them rather than appear broken.
  const bulkDisabled = !!filter || expandableIds.length === 0
  const allCollapsed = expandableIds.length > 0 && expandableIds.every((id) => collapsedIds.has(id))
  const allExpanded = collapsedIds.size === 0

  const selectedCollectionId = selected && selected.kind !== 'environment' ? selected.collectionId :
    sorted[0]?.id

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-heading">
        <span>Collections</span>
        <div className="sidebar-tools">
          <button
            title={bulkDisabled ? 'Clear the search to expand all' : 'Expand all folders'}
            aria-label="Expand all"
            disabled={bulkDisabled || allExpanded}
            onClick={() => setCollapsedIds(new Set())}
          >⤢</button>
          <button
            title={bulkDisabled ? 'Clear the search to collapse all' : 'Collapse all folders'}
            aria-label="Collapse all"
            disabled={bulkDisabled || allCollapsed}
            onClick={() => setCollapsedIds(new Set(expandableIds))}
          >⤡</button>
          <span className="sidebar-tools-divider" aria-hidden="true" />
          <button title="New request" aria-label="New request" onClick={onCreateRequest}>＋</button>
          <button title="New folder" aria-label="New folder" onClick={onCreateFolder}>▱</button>
          <button title="New collection" aria-label="New collection" onClick={onCreateCollection}>▤</button>
        </div>
      </div>
      <label className="search">
        <span aria-hidden="true">⌕</span>
        <input aria-label="Search collections" placeholder="Search collections" value={search} onChange={(event) => setSearch(event.target.value)} />
      </label>
      <nav className="tree" aria-label="Collections">
        {sorted.filter((collection) => !filter || collection.name.toLowerCase().includes(filter) ||
          collection.items.some((item) => containsMatch(item, filter))).map((collection) => (
          <CollectionTree
            key={collection.id}
            collection={collection}
            selected={selected}
            onSelect={onSelect}
            onDelete={onDelete}
            filter={filter}
            selectedCollectionId={selectedCollectionId}
            expansion={expansion}
          />
        ))}
        {sorted.length === 0 && <p className="empty-tree">No collections yet.</p>}
      </nav>
      <div className="sidebar-bottom">
        <button className="sidebar-link" onClick={onShowEnvironments}>◉ &nbsp; Environments</button>
        <button className="sidebar-link" onClick={onShowHistory}>▥ &nbsp; History</button>
        <button className="sidebar-link" onClick={onShowTrash}>▱ &nbsp; Trash</button>
      </div>
    </aside>
  )
}

function CollectionTree({
  collection,
  selected,
  onSelect,
  onDelete,
  filter,
  selectedCollectionId,
  expansion,
}: {
  collection: CollectionResource
  selected: OpenResource | null
  onSelect: (resource: OpenResource) => void
  onDelete: (resource: OpenResource) => void
  filter: string
  selectedCollectionId?: string
  expansion: ExpansionState
}) {
  const expanded = !expansion.isCollapsed(collection.id)
  const isSelected = selected?.kind === 'collection' && selected.collectionId === collection.id
  const children = collection.items.filter((item) => !filter || containsMatch(item, filter))
  return (
    <>
      <div className={`tree-row collection ${isSelected ? 'selected' : ''}`}>
        <button className="tree-chevron" aria-label={`${expanded ? 'Collapse' : 'Expand'} ${collection.name}`} onClick={() => expansion.toggle(collection.id)}>
          {expanded ? '▾' : '▸'}
        </button>
        <button className="tree-name" onClick={() => onSelect({ kind: 'collection', collectionId: collection.id })} title={collection.name}>
          <span className="tree-collection-mark">▤</span> {collection.name}
        </button>
        <button className="tree-delete" title={`Move ${collection.name} to Trash`} aria-label={`Move ${collection.name} to Trash`} onClick={() => onDelete({ kind: 'collection', collectionId: collection.id })}>×</button>
      </div>
      {(expanded || !!filter) && sortByName(children).map((item) => (
        <TreeItem key={item.id} collectionId={collection.id} item={item} depth={1} selected={selected} onSelect={onSelect} onDelete={onDelete} filter={filter} expansion={expansion} />
      ))}
      {collection.id === selectedCollectionId && expanded && !filter && collection.items.length === 0 && (
        <p className="empty-tree nested">No requests yet.</p>
      )}
    </>
  )
}
