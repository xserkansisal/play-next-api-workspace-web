import { useCallback, useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'

import { fitSidebarWidth } from '@/lib/sidebar-width-storage'
import { loadCollapsedIds, pruneCollapsedIds, saveCollapsedIds } from '@/lib/tree-expansion-storage'
import { sortByName } from '@/lib/workspace-ui'
import type { CollectionResource, EnvironmentResource, OpenResource, WorkspaceItem } from '@/lib/workspace-types'

/**
 * The two sidebar sections fold like any other node, so their state rides along in the same stored
 * collapsed set. The ids are namespaced to keep them from ever colliding with a resource id.
 */
export const COLLECTIONS_SECTION = 'section:collections'
export const ENVIRONMENTS_SECTION = 'section:environments'

interface WorkspaceTreeProps {
  collections: CollectionResource[]
  selected: OpenResource | null
  onSelect: (resource: OpenResource) => void
  onCreateCollection: () => void
  onCreateFolder: () => void
  onCreateRequest: () => void
  onDelete: (resource: OpenResource) => void
  onClone: (resource: OpenResource) => void
  /** Id of the resource whose copy is still being written, so its button cannot be pressed twice. */
  cloningId: string | null
  onShowTrash: () => void
  onShowHistory: () => void
  collapsed: boolean
  environments: EnvironmentResource[]
  onCreateEnvironment: () => void
  /** Width in pixels; owned by the caller so it can be persisted and applied to the layout. */
  width: number
  onResize: (width: number) => void
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
  onClone,
  cloningId,
  filter,
  expansion,
}: {
  collectionId: string
  item: WorkspaceItem
  depth: number
  selected: OpenResource | null
  onSelect: (resource: OpenResource) => void
  onDelete: (resource: OpenResource) => void
  onClone: (resource: OpenResource) => void
  cloningId: string | null
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
        <button className="tree-clone" title={`Duplicate ${item.name}`} aria-label={`Duplicate ${item.name}`} disabled={cloningId === item.id} onClick={() => onClone(resource)}>⧉</button>
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
          onClone={onClone}
          cloningId={cloningId}
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

/** A foldable sidebar section header, so Collections and Environments behave the same way. */
function SectionHeader({ label, count, expanded, onToggle, children }: {
  label: string
  count: number
  expanded: boolean
  onToggle: () => void
  children?: ReactNode
}) {
  return (
    <div className="sidebar-heading">
      <button
        className="sidebar-section-toggle"
        aria-expanded={expanded}
        aria-label={`${expanded ? 'Collapse' : 'Expand'} ${label}`}
        onClick={onToggle}
      >
        <span className="tree-chevron-mark" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
        <span>{label}</span>
        <span className="sidebar-section-count">{count}</span>
      </button>
      <div className="sidebar-tools">{children}</div>
    </div>
  )
}

export function WorkspaceTree({
  collections,
  selected,
  onSelect,
  onCreateCollection,
  onCreateFolder,
  onCreateRequest,
  onDelete,
  onClone,
  cloningId,
  onShowTrash,
  onShowHistory,
  collapsed,
  environments,
  onCreateEnvironment,
  width,
  onResize,
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
  //
  // The section ids are listed as known even though they belong to no resource: pruning would
  // otherwise drop them on the next load and quietly reopen a section the user had folded.
  //
  // An empty tree stays empty here, because `pruneCollapsedIds` reads that as "not loaded yet" and
  // skips pruning. Appending the sections unconditionally would defeat that guard and wipe the
  // user's collapsed folders during the first render, before the collections arrive.
  const knownIds = useMemo(
    () => expandableIds.length === 0 ? expandableIds : [...expandableIds, COLLECTIONS_SECTION, ENVIRONMENTS_SECTION],
    [expandableIds],
  )
  useEffect(() => {
    setCollapsedIds((current) => pruneCollapsedIds(current, knownIds))
  }, [knownIds])

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

  const sortedEnvironments = useMemo(() => sortByName(environments), [environments])
  const visibleEnvironments = filter
    ? sortedEnvironments.filter((entry) => entry.name.toLowerCase().includes(filter))
    : sortedEnvironments

  // Kept in state rather than read during render, so a window resize actually repaints the sidebar.
  const [viewportWidth, setViewportWidth] = useState(() => (typeof window === 'undefined' ? 0 : window.innerWidth))
  useEffect(() => {
    const update = () => setViewportWidth(window.innerWidth)
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  const appliedWidth = fitSidebarWidth(width, viewportWidth)

  const collectionsOpen = !collapsedIds.has(COLLECTIONS_SECTION)
  const environmentsOpen = !collapsedIds.has(ENVIRONMENTS_SECTION)

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    const move = (moveEvent: PointerEvent) => onResize(moveEvent.clientX)
    const stop = () => window.removeEventListener('pointermove', move)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop, { once: true })
  }

  const visibleCollections = sorted.filter((collection) => !filter ||
    collection.name.toLowerCase().includes(filter) ||
    collection.items.some((item) => containsMatch(item, filter)))

  return (
    <>
      {/*
        The width is omitted while collapsed: an inline style outranks the stylesheet, so applying
        it would override the collapsed rail's own width and leave the sidebar wide open.
      */}
      <aside
        className={`sidebar ${collapsed ? 'collapsed' : ''}`}
        style={collapsed ? undefined : { flexBasis: `${appliedWidth}px`, width: `${appliedWidth}px`, minWidth: `${appliedWidth}px` }}
      >
        <SectionHeader label="Collections" count={sorted.length} expanded={collectionsOpen} onToggle={() => toggle(COLLECTIONS_SECTION)}>
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
        </SectionHeader>
        <label className="search">
          <span aria-hidden="true">⌕</span>
          <input aria-label="Search collections" placeholder="Search collections and environments" value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
        {collectionsOpen && (
          <nav className="tree" aria-label="Collections">
            {visibleCollections.map((collection) => (
              <CollectionTree
                key={collection.id}
                collection={collection}
                selected={selected}
                onSelect={onSelect}
                onDelete={onDelete}
                onClone={onClone}
                cloningId={cloningId}
                filter={filter}
                selectedCollectionId={selectedCollectionId}
                expansion={expansion}
              />
            ))}
            {sorted.length === 0 && <p className="empty-tree">No collections yet.</p>}
            {sorted.length > 0 && visibleCollections.length === 0 && <p className="empty-tree">No matching collections.</p>}
          </nav>
        )}
        <div className="sidebar-section environments-section">
          <SectionHeader label="Environments" count={environments.length} expanded={environmentsOpen} onToggle={() => toggle(ENVIRONMENTS_SECTION)}>
            <button title="New environment" aria-label="New environment" onClick={onCreateEnvironment}>＋</button>
          </SectionHeader>
          {environmentsOpen && (
            <nav className="tree environments-tree" aria-label="Environments">
              {visibleEnvironments.map((environment) => {
                const isSelected = selected?.kind === 'environment' && selected.environmentId === environment.id
                return (
                  <div key={environment.id} className={`tree-row environment ${isSelected ? 'selected' : ''}`}>
                    <span className="tree-environment-mark" aria-hidden="true">◉</span>
                    <button className="tree-name" title={environment.name} onClick={() => onSelect({ kind: 'environment', environmentId: environment.id })}>
                      {environment.name}
                    </button>
                    <button
                      className="tree-clone"
                      title={`Duplicate ${environment.name}`}
                      aria-label={`Duplicate ${environment.name}`}
                      disabled={cloningId === environment.id}
                      onClick={() => onClone({ kind: 'environment', environmentId: environment.id })}
                    >⧉</button>
                    <button
                      className="tree-delete"
                      title={`Move ${environment.name} to Trash`}
                      aria-label={`Move ${environment.name} to Trash`}
                      onClick={() => onDelete({ kind: 'environment', environmentId: environment.id })}
                    >×</button>
                  </div>
                )
              })}
              {environments.length === 0 && <p className="empty-tree">No environments yet.</p>}
              {environments.length > 0 && visibleEnvironments.length === 0 && <p className="empty-tree">No matching environments.</p>}
            </nav>
          )}
        </div>
        <div className="sidebar-bottom">
          <button className="sidebar-link" onClick={onShowHistory}>▥ &nbsp; History</button>
          <button className="sidebar-link" onClick={onShowTrash}>▱ &nbsp; Trash</button>
        </div>
      </aside>
      {!collapsed && <div
        className="sidebar-resize-handle"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        onPointerDown={startResize}
      />}
    </>
  )
}

function CollectionTree({
  collection,
  selected,
  onSelect,
  onDelete,
  onClone,
  cloningId,
  filter,
  selectedCollectionId,
  expansion,
}: {
  collection: CollectionResource
  selected: OpenResource | null
  onSelect: (resource: OpenResource) => void
  onDelete: (resource: OpenResource) => void
  onClone: (resource: OpenResource) => void
  cloningId: string | null
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
        <button className="tree-clone" title={`Duplicate ${collection.name}`} aria-label={`Duplicate ${collection.name}`} disabled={cloningId === collection.id} onClick={() => onClone({ kind: 'collection', collectionId: collection.id })}>⧉</button>
        <button className="tree-delete" title={`Move ${collection.name} to Trash`} aria-label={`Move ${collection.name} to Trash`} onClick={() => onDelete({ kind: 'collection', collectionId: collection.id })}>×</button>
      </div>
      {(expanded || !!filter) && sortByName(children).map((item) => (
        <TreeItem key={item.id} collectionId={collection.id} item={item} depth={1} selected={selected} onSelect={onSelect} onDelete={onDelete} onClone={onClone} cloningId={cloningId} filter={filter} expansion={expansion} />
      ))}
      {collection.id === selectedCollectionId && expanded && !filter && collection.items.length === 0 && (
        <p className="empty-tree nested">No requests yet.</p>
      )}
    </>
  )
}
