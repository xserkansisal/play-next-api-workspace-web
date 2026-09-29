import { useMemo, useState } from 'react'

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

function TreeItem({
  collectionId,
  item,
  depth,
  selected,
  onSelect,
  onDelete,
  filter,
}: {
  collectionId: string
  item: WorkspaceItem
  depth: number
  selected: OpenResource | null
  onSelect: (resource: OpenResource) => void
  onDelete: (resource: OpenResource) => void
  filter: string
}) {
  const [expanded, setExpanded] = useState(true)
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
          <button className="tree-chevron" onClick={() => setExpanded((value) => !value)} aria-label={`${expanded ? 'Collapse' : 'Expand'} ${item.name}`}>
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
  const filter = search.trim().toLowerCase()
  const sorted = useMemo(() => sortByName(collections), [collections])
  const selectedCollectionId = selected && selected.kind !== 'environment' ? selected.collectionId :
    sorted[0]?.id

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-heading">
        <span>Collections</span>
        <div className="sidebar-tools">
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
}: {
  collection: CollectionResource
  selected: OpenResource | null
  onSelect: (resource: OpenResource) => void
  onDelete: (resource: OpenResource) => void
  filter: string
  selectedCollectionId?: string
}) {
  const [expanded, setExpanded] = useState(true)
  const isSelected = selected?.kind === 'collection' && selected.collectionId === collection.id
  const children = collection.items.filter((item) => !filter || containsMatch(item, filter))
  return (
    <>
      <div className={`tree-row collection ${isSelected ? 'selected' : ''}`}>
        <button className="tree-chevron" aria-label={`${expanded ? 'Collapse' : 'Expand'} ${collection.name}`} onClick={() => setExpanded((value) => !value)}>
          {expanded ? '▾' : '▸'}
        </button>
        <button className="tree-name" onClick={() => onSelect({ kind: 'collection', collectionId: collection.id })} title={collection.name}>
          <span className="tree-collection-mark">▤</span> {collection.name}
        </button>
        <button className="tree-delete" title={`Move ${collection.name} to Trash`} aria-label={`Move ${collection.name} to Trash`} onClick={() => onDelete({ kind: 'collection', collectionId: collection.id })}>×</button>
      </div>
      {(expanded || !!filter) && sortByName(children).map((item) => (
        <TreeItem key={item.id} collectionId={collection.id} item={item} depth={1} selected={selected} onSelect={onSelect} onDelete={onDelete} filter={filter} />
      ))}
      {collection.id === selectedCollectionId && expanded && !filter && collection.items.length === 0 && (
        <p className="empty-tree nested">No requests yet.</p>
      )}
    </>
  )
}
